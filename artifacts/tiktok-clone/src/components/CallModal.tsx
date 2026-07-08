import React, { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from "lucide-react";
import { useCall } from "@/contexts/CallContext";
import { cn } from "@/lib/utils";

interface Point { x: number; y: number }

const PIP_WIDTH = 112;  // w-28
const PIP_HEIGHT = 112 * (16 / 9); // aspect-[9/16] (height = width * 16/9)
const PIP_MARGIN = 16;  // right-4 / bottom-28
const PIP_BOTTOM_OFFSET = 112; // bottom-28 = 7rem = 112px

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Generate a ringtone using Web Audio API. Returns a stop function.
 *
 * Uses a single repeating setInterval to schedule beeps, so silence windows
 * do not break the chain.
 */
function playRingtone(ctx: AudioContext, kind: "incoming" | "outgoing"): () => void {
  const tone = 440; // A4
  const gain = ctx.createGain();
  gain.connect(ctx.destination);

  // Incoming: two 0.2s beeps 0.4s apart, then 0.8s silence (1.2s total loop).
  // Outgoing: two 0.15s beeps 0.2s apart, then 0.4s silence (0.8s total loop).
  const beats = kind === "incoming"
    ? [{ at: 0, dur: 0.2 }, { at: 0.4, dur: 0.2 }]
    : [{ at: 0, dur: 0.15 }, { at: 0.2, dur: 0.15 }];
  const loop = kind === "incoming" ? 1.2 : 0.8;
  const volume = 0.15;

  let cancelled = false;
  let loopStart = ctx.currentTime;

  const tick = () => {
    if (cancelled) return;
    const t = ctx.currentTime;
    // If the tab was suspended, skip missed loops to avoid a burst on resume.
    if (loopStart < t - 0.5) loopStart = t;
    while (loopStart < t + 0.25) { // schedule ahead slightly
      for (const beat of beats) {
        const start = loopStart + beat.at;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = tone;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(volume, start + 0.01);
        env.gain.setValueAtTime(volume, start + beat.dur - 0.01);
        env.gain.linearRampToValueAtTime(0, start + beat.dur);
        osc.connect(env);
        env.connect(gain);
        osc.start(start);
        osc.stop(start + beat.dur + 0.02);
      }
      loopStart += loop;
    }
  };

  tick();
  const interval = setInterval(tick, 200);

  return () => {
    cancelled = true;
    clearInterval(interval);
    try { gain.disconnect(); } catch { /* ignore */ }
  };
}

export function CallModal() {
  const { activeCall, acceptCall, rejectCall, endCall } = useCall();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Draggable PiP position (top/left in px)
  const [pipPos, setPipPos] = useState<Point>({ x: -1, y: -1 });

  /**
   * Attach local stream imperatively with explicit .play().
   *
   * The <video> element is always rendered (hidden via CSS) so localVideoRef.current
   * is never null when this effect fires. autoPlay alone is not reliable for
   * MediaStream srcObject — explicit .play() is required on some browsers.
   */
  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (activeCall?.localStream) {
      el.srcObject = activeCall.localStream;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [activeCall?.localStream]);

  /** Same treatment for the remote stream. */
  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    if (activeCall?.remoteStream) {
      el.srcObject = activeCall.remoteStream;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [activeCall?.remoteStream]);

  // Reset toggles when a new call starts (or call ends)
  useEffect(() => {
    if (!activeCall) {
      setCamOff(false);
      setMicMuted(false);
      setElapsed(0);
    }
  }, [activeCall]);

  // Elapsed timer — only runs while call is active
  useEffect(() => {
    if (activeCall?.state !== "active") { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [activeCall?.state]);

  // Initialize PiP position at bottom-right when video area is available
  useEffect(() => {
    const area = videoAreaRef.current;
    if (!area || pipPos.x >= 0) return;
    const rect = area.getBoundingClientRect();
    setPipPos({
      x: clamp(rect.width - PIP_WIDTH - PIP_MARGIN, PIP_MARGIN, rect.width - PIP_WIDTH - PIP_MARGIN),
      y: clamp(rect.height - PIP_HEIGHT - PIP_BOTTOM_OFFSET, PIP_MARGIN, rect.height - PIP_HEIGHT - PIP_MARGIN),
    });
  }, [pipPos.x]);

  // Keep PiP inside bounds on resize
  useEffect(() => {
    const handleResize = () => {
      const area = videoAreaRef.current;
      if (!area) return;
      const rect = area.getBoundingClientRect();
      setPipPos((prev) => ({
        x: clamp(prev.x, PIP_MARGIN, Math.max(PIP_MARGIN, rect.width - PIP_WIDTH - PIP_MARGIN)),
        y: clamp(prev.y, PIP_MARGIN, Math.max(PIP_MARGIN, rect.height - PIP_HEIGHT - PIP_MARGIN)),
      }));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Drag handlers
  const dragStart = useRef<Point | null>(null);
  const posStart = useRef<Point | null>(null);

  const activePointerId = useRef<number | null>(null);

  const endDrag = useCallback(() => {
    activePointerId.current = null;
    dragStart.current = null;
    posStart.current = null;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    activePointerId.current = e.pointerId;
    dragStart.current = { x: e.clientX, y: e.clientY };
    posStart.current = { ...pipPos };
  }, [pipPos]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLVideoElement>) => {
    if (activePointerId.current !== e.pointerId || !dragStart.current || !posStart.current || !videoAreaRef.current) return;
    const areaRect = videoAreaRef.current.getBoundingClientRect();
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPipPos({
      x: clamp(posStart.current.x + dx, PIP_MARGIN, Math.max(PIP_MARGIN, areaRect.width - PIP_WIDTH - PIP_MARGIN)),
      y: clamp(posStart.current.y + dy, PIP_MARGIN, Math.max(PIP_MARGIN, areaRect.height - PIP_HEIGHT - PIP_MARGIN)),
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLVideoElement>) => {
    if (activePointerId.current === e.pointerId) endDrag();
  }, [endDrag]);

  const onLostPointerCapture = useCallback(() => { endDrag(); }, [endDrag]);

  // Ringtone while in ringing state (both incoming and outgoing)
  useEffect(() => {
    if (!activeCall || activeCall.state !== "ringing") return;
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    // Best-effort resume; some browsers require a user gesture before audio can play.
    ctx.resume().catch(() => {});
    const stop = playRingtone(ctx, activeCall.direction === "incoming" ? "incoming" : "outgoing");
    return () => {
      stop();
      ctx.close().catch(() => {});
    };
  }, [activeCall?.state, activeCall?.direction]);

  if (!activeCall) return null;

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const toggleMic = () => {
    const track = activeCall.localStream?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setMicMuted((m) => !m); }
  };

  const toggleCam = () => {
    const track = activeCall.localStream?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setCamOff((c) => !c); }
  };

  const isVideo = activeCall.callType === "video";
  const isRinging = activeCall.state === "ringing";
  const isActive = activeCall.state === "active";

  const stateLabel = isRinging
    ? activeCall.direction === "incoming"
      ? activeCall.callType === "video" ? "Video call incoming…" : "Call incoming…"
      : "Calling…"
    : isActive
    ? fmt(elapsed)
    : "Connecting…";

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* ── Video area ─────────────────────────────────────────────────── */}
      <div ref={videoAreaRef} className={cn("relative flex-1 bg-zinc-900 overflow-hidden", !isVideo && "hidden")}>
        {/* Remote stream — always in DOM so ref is stable; hidden until stream arrives */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={cn(
            "w-full h-full object-cover",
            !activeCall.remoteStream && "hidden",
          )}
        />

        {/* Avatar fallback while waiting for remote */}
        {!activeCall.remoteStream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center text-4xl font-bold text-white">
              {activeCall.peerUsername[0]?.toUpperCase() ?? "?"}
            </div>
            <span className="text-white/60 text-sm">{stateLabel}</span>
          </div>
        )}

        {/* Caller info overlay */}
        <div className="absolute top-12 left-0 right-0 flex flex-col items-center gap-1 pointer-events-none">
          <h2 className="text-white font-semibold drop-shadow-lg">{activeCall.peerUsername}</h2>
          {activeCall.remoteStream && (
            <p className="text-white/60 text-xs drop-shadow-md">{stateLabel}</p>
          )}
        </div>

        {/*
          Local stream PiP — ALWAYS rendered (hidden via CSS when no stream / cam off).
          Keeping the element in the DOM ensures localVideoRef.current is set when the
          stream arrives, so the effect above can assign srcObject immediately.
        */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={onLostPointerCapture}
          style={{
            position: "absolute",
            left: pipPos.x >= 0 ? pipPos.x : undefined,
            top: pipPos.y >= 0 ? pipPos.y : undefined,
            width: PIP_WIDTH,
            height: PIP_HEIGHT,
            cursor: "move",
            touchAction: "none",
          }}
          className={cn(
            "aspect-[9/16] object-cover rounded-2xl border-2 border-white/20 shadow-xl",
            (camOff || !activeCall.localStream) && "hidden",
          )}
        />
      </div>

      {/* ── Audio-only area ────────────────────────────────────────────── */}
      {!isVideo && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-zinc-900 to-black">
          <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center text-4xl font-bold text-white">
            {activeCall.peerUsername[0]?.toUpperCase() ?? "?"}
          </div>
          <h2 className="text-white text-xl font-semibold">{activeCall.peerUsername}</h2>
          <p className="text-white/50 text-sm">{stateLabel}</p>
        </div>
      )}

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="shrink-0 pb-12 pt-4 px-8 bg-black">
        {isRinging && activeCall.direction === "incoming" ? (
          <div className="flex items-center justify-around">
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={rejectCall}
                className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-400 transition-colors active:scale-95"
              >
                <PhoneOff className="w-7 h-7 text-white" />
              </button>
              <span className="text-white/60 text-xs">Decline</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={acceptCall}
                className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center hover:bg-emerald-400 transition-colors active:scale-95"
              >
                {isVideo ? <Video className="w-7 h-7 text-white" /> : <Phone className="w-7 h-7 text-white" />}
              </button>
              <span className="text-white/60 text-xs">Accept</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-around">
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={toggleMic}
                className={cn(
                  "w-14 h-14 rounded-full flex items-center justify-center transition-colors active:scale-95",
                  micMuted ? "bg-white text-black" : "bg-white/15 text-white",
                )}
              >
                {micMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
              <span className="text-white/50 text-xs">{micMuted ? "Unmute" : "Mute"}</span>
            </div>

            {isVideo && (
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={toggleCam}
                  className={cn(
                    "w-14 h-14 rounded-full flex items-center justify-center transition-colors active:scale-95",
                    camOff ? "bg-white text-black" : "bg-white/15 text-white",
                  )}
                >
                  {camOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
                </button>
                <span className="text-white/50 text-xs">{camOff ? "Camera on" : "Camera off"}</span>
              </div>
            )}

            <div className="flex flex-col items-center gap-2">
              <button
                onClick={endCall}
                className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-400 transition-colors active:scale-95"
              >
                <PhoneOff className="w-6 h-6 text-white" />
              </button>
              <span className="text-white/50 text-xs">End</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
