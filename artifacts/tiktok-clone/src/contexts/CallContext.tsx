import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useMessagingWebSocket, type CallOfferPayload } from "@/hooks/useMessagingWebSocket";
import { useToast } from "@/hooks/use-toast";

interface ActiveCall {
  peerId: number;
  peerUsername: string;
  callType: "audio" | "video";
  direction: "incoming" | "outgoing";
  state: "ringing" | "connecting" | "active" | "ended";
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

interface CallContextValue {
  activeCall: ActiveCall | null;
  wsConnected: boolean;
  initiateCall: (peerId: number, peerUsername: string, callType: "audio" | "video") => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  sendMessage: ReturnType<typeof useMessagingWebSocket>["send"];
  onWsEvent: ReturnType<typeof useMessagingWebSocket>["on"];
}

const CallCtx = createContext<CallContextValue | null>(null);

// STUN alone can't traverse symmetric NATs / restrictive firewalls — calls
// would hang at "connecting" forever with no relay fallback. OpenRelay's free
// public TURN server covers that case (fine for low-volume/dev use).
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { send, on, connected: wsConnected } = useMessagingWebSocket();

  // Use refs to avoid stale closures in WS event handlers
  const activeCallRef = useRef<ActiveCall | null>(null);
  const [activeCall, setActiveCallState] = useState<ActiveCall | null>(null);
  const setActiveCall = useCallback((next: ActiveCall | null | ((prev: ActiveCall | null) => ActiveCall | null)) => {
    setActiveCallState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      activeCallRef.current = value;
      return value;
    });
  }, []);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingOffer = useRef<CallOfferPayload | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidate[]>([]);
  const remoteDescSet = useRef(false);

  const stopStreams = useCallback((call: ActiveCall | null) => {
    call?.localStream?.getTracks().forEach((t) => t.stop());
    call?.remoteStream?.getTracks().forEach((t) => t.stop());
  }, []);

  const closePC = useCallback(() => {
    if (pcRef.current) {
      // Null out handlers before closing to prevent callbacks after cleanup
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    iceCandidateQueue.current = [];
    remoteDescSet.current = false;
  }, []);

  const endCall = useCallback(() => {
    setActiveCall((prev) => {
      if (prev) {
        send({ type: "call:end", payload: { to: prev.peerId } });
        stopStreams(prev);
      }
      return null;
    });
    closePC();
    pendingOffer.current = null;
  }, [send, stopStreams, closePC, setActiveCall]);

  const rejectCall = useCallback(() => {
    setActiveCall((prev) => {
      if (prev) {
        send({ type: "call:reject", payload: { to: prev.peerId } });
        stopStreams(prev);
      }
      return null;
    });
    closePC();
    pendingOffer.current = null;
  }, [send, stopStreams, closePC, setActiveCall]);

  async function drainIceCandidates(pc: RTCPeerConnection) {
    for (const candidate of iceCandidateQueue.current) {
      try { await pc.addIceCandidate(candidate); } catch { /* ignore */ }
    }
    iceCandidateQueue.current = [];
  }

  /**
   * Wire up shared PC event handlers.
   *
   * Separation of concerns:
   *  - ontrack        → stores the remote stream only; does NOT set state to "active".
   *  - oniceconnectionstatechange → drives "active" (connected/completed) and "failed" cleanup.
   *    Also handles "disconnected" with a 6 s recovery window before treating it as failed.
   *
   * This avoids a race where ontrack fires during setRemoteDescription (before ICE succeeds)
   * and incorrectly marks the call as active, then acceptCall's setState overwrites it back to
   * "connecting".
   */
  function setupPC(pc: RTCPeerConnection, peerId: number) {
    // Timer used to convert a transient "disconnected" into a terminal failure
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanupICETimer = () => {
      if (disconnectTimer !== null) { clearTimeout(disconnectTimer); disconnectTimer = null; }
    };

    const terminateCall = () => {
      cleanupICETimer();
      const call = activeCallRef.current;
      if (call) {
        send({ type: "call:end", payload: { to: call.peerId } });
        stopStreams(call);
      }
      closePC();
      setActiveCall(null);
      pendingOffer.current = null;
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send({ type: "call:ice-candidate", payload: { to: peerId, candidate: e.candidate.toJSON() } });
      }
    };

    pc.ontrack = (e) => {
      const remoteStream = e.streams[0] ?? null;
      if (remoteStream) {
        setActiveCall((prev) => prev ? { ...prev, remoteStream } : prev);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;

      if (state === "connected" || state === "completed") {
        // ICE succeeded (or recovered) → media flows → mark active
        cleanupICETimer();
        setActiveCall((prev) => prev ? { ...prev, state: "active" } : prev);
      } else if (state === "disconnected") {
        // Transient — give ICE 6 s to recover before treating as fatal.
        // Compare against the captured `pc` (not pcRef.current) so a stale timer
        // from a previous call can never affect a new call's PC.
        cleanupICETimer();
        disconnectTimer = setTimeout(() => {
          if (pcRef.current === pc && pc.iceConnectionState === "disconnected") {
            terminateCall();
          }
        }, 6_000);
      } else if (state === "failed") {
        // Hard ICE failure — tear down immediately
        terminateCall();
      }
    };
  }

  const initiateCall = useCallback(async (peerId: number, peerUsername: string, callType: "audio" | "video") => {
    if (activeCallRef.current) return; // already in a call
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === "video" });
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      remoteDescSet.current = false;
      iceCandidateQueue.current = [];

      setupPC(pc, peerId);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      setActiveCall({ peerId, peerUsername, callType, direction: "outgoing", state: "ringing", localStream: stream, remoteStream: null });
      send({ type: "call:offer", payload: { to: peerId, offer: { type: offer.type, sdp: offer.sdp }, callType } });
    } catch (err) {
      console.error("Failed to start call:", err);
      closePC();
      alert("No se puede acceder a la cámara/micrófono. Verifica los permisos.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, closePC, setActiveCall, stopStreams]);

  const acceptCall = useCallback(async () => {
    const offer = pendingOffer.current;
    const call = activeCallRef.current;
    if (!offer || !call) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: offer.callType === "video" });
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      remoteDescSet.current = false;
      iceCandidateQueue.current = [];

      setupPC(pc, offer.from);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // setRemoteDescription may fire ontrack synchronously — that's fine, it only stores remoteStream now
      await pc.setRemoteDescription(new RTCSessionDescription(offer.offer as RTCSessionDescriptionInit));
      remoteDescSet.current = true;
      await drainIceCandidates(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ type: "call:answer", payload: { to: offer.from, answer: { type: answer.type, sdp: answer.sdp } } });

      // Only move to "connecting" if ICE hasn't already promoted us to "active"
      setActiveCall((prev) => prev ? { ...prev, localStream: stream, state: prev.state === "active" ? "active" : "connecting" } : prev);
      pendingOffer.current = null;
    } catch (err) {
      console.error("Failed to accept call:", err);
      rejectCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, rejectCall, setActiveCall]);

  // Give ICE a bounded window to connect. Without this, a call that never
  // finds a working candidate pair (e.g. a flaky/unreachable TURN relay)
  // hangs on "connecting" forever with no feedback — the state only flips
  // to "failed" if ICE explicitly reports it, which doesn't always happen.
  const { toast } = useToast();
  useEffect(() => {
    if (activeCall?.state !== "connecting") return;
    const timer = setTimeout(() => {
      if (activeCallRef.current?.state === "connecting") {
        toast({ variant: "destructive", description: "No se pudo conectar la llamada. Intenta de nuevo." });
        endCall();
      }
    }, 20_000);
    return () => clearTimeout(timer);
  }, [activeCall?.state, endCall, toast]);

  // Single stable WS event handler using refs to avoid stale closure issues
  useEffect(() => {
    const off = on(async (event) => {
      switch (event.type) {
        case "call:offer": {
          const o = event.payload;
          if (activeCallRef.current) {
            send({ type: "call:reject", payload: { to: o.from } });
            return;
          }
          pendingOffer.current = o;
          setActiveCall({ peerId: o.from, peerUsername: o.fromUsername, callType: o.callType, direction: "incoming", state: "ringing", localStream: null, remoteStream: null });
          break;
        }
        case "call:answer": {
          const pc = pcRef.current;
          if (!pc || !event.payload.answer) return;
          await pc.setRemoteDescription(new RTCSessionDescription(event.payload.answer as RTCSessionDescriptionInit));
          remoteDescSet.current = true;
          await drainIceCandidates(pc);
          // Only move to "connecting" if ICE hasn't already promoted us to "active"
          setActiveCall((prev) => prev ? { ...prev, state: prev.state === "active" ? "active" : "connecting" } : prev);
          break;
        }
        case "call:ice-candidate": {
          const pc = pcRef.current;
          if (!pc) return;
          const candidate = new RTCIceCandidate(event.payload.candidate as RTCIceCandidateInit);
          if (remoteDescSet.current) {
            try { await pc.addIceCandidate(candidate); } catch { /* ignore */ }
          } else {
            iceCandidateQueue.current.push(candidate);
          }
          break;
        }
        case "call:end":
        case "call:reject": {
          setActiveCall((prev) => { if (prev) stopStreams(prev); return null; });
          closePC();
          pendingOffer.current = null;
          break;
        }
      }
    });
    return off;
  }, [on, send, stopStreams, closePC, setActiveCall]);

  return (
    <CallCtx.Provider value={{ activeCall, wsConnected, initiateCall, acceptCall, rejectCall, endCall, sendMessage: send, onWsEvent: on }}>
      {children}
    </CallCtx.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallCtx);
  if (!ctx) throw new Error("useCall must be used inside CallProvider");
  return ctx;
}
