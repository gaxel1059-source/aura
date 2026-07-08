import { useEffect, useRef, useCallback, useState } from "react";
import { useAuth } from "@clerk/react";
import { basePath } from "@/lib/utils";

export type WsIncomingEvent =
  | { type: "connected"; payload: { userId: number } }
  | { type: "message:new"; payload: MessagePayload }
  | { type: "call:offer"; payload: CallOfferPayload }
  | { type: "call:answer"; payload: { to: number; answer: RTCSessionDescriptionInit } }
  | { type: "call:ice-candidate"; payload: { to: number; candidate: RTCIceCandidateInit } }
  | { type: "call:end"; payload: { to: number } }
  | { type: "call:reject"; payload: { to: number } };

export interface MessagePayload {
  id: number;
  conversationId: number;
  senderId: number;
  type: string;
  content: string | null;
  stickerUrl: string | null;
  callDuration: number | null;
  createdAt: string;
  sender: { id: number; username: string; displayName: string; avatarUrl: string | null };
}

export interface CallOfferPayload {
  to: number;
  offer: RTCSessionDescriptionInit;
  callType: "audio" | "video";
  from: number;
  fromUsername: string;
}

type EventHandler = (event: WsIncomingEvent) => void;

export function useMessagingWebSocket() {
  const { getToken, isSignedIn } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<EventHandler>>(new Set());
  const [connected, setConnected] = useState(false);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const on = useCallback((handler: EventHandler): (() => void) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;

    let ws: WebSocket | null = null;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (disposed) return;
      try {
        const token = await getToken();
        if (!token || disposed) return;

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        const base = basePath.replace(/\/$/, "");
        const url = `${proto}//${host}${base}/api/ws?token=${encodeURIComponent(token)}`;

        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!disposed) setConnected(true);
        };

        ws.onmessage = (ev) => {
          try {
            const event = JSON.parse(ev.data as string) as WsIncomingEvent;
            for (const h of handlersRef.current) h(event);
          } catch { /* ignore */ }
        };

        ws.onclose = () => {
          if (!disposed) {
            setConnected(false);
            reconnectTimer = setTimeout(connect, 3000);
          }
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch { /* ignore */ }
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [isSignedIn, getToken]);

  return { send, on, connected };
}
