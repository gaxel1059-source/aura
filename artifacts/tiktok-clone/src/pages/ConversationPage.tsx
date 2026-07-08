import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Phone, Video, Send, Loader2, Smile } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { StickerPicker } from "@/components/StickerPicker";
import { useCall } from "@/contexts/CallContext";
import { basePath } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Participant {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface MessageItem {
  id: number;
  conversationId: number;
  senderId: number;
  type: string;
  content: string | null;
  stickerUrl: string | null;
  callDuration: number | null;
  createdAt: string;
  sender: Participant;
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatCallDuration(s: number | null) {
  if (s === null) return "Missed";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const convId = Number(params.id);
  const [, navigate] = useLocation();

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { initiateCall, onWsEvent } = useCall();

  const other = participants.find((p) => p.id !== currentUserId) ?? participants[0];

  // ── initial data load ──
  useEffect(() => {
    if (!convId) return;

    // Get current user ID
    fetch(`${basePath}/api/users/me`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setCurrentUserId(d.id ?? null))
      .catch(() => {});

    setLoading(true);
    fetch(`${basePath}/api/conversations/${convId}/messages?limit=30`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const msgs: MessageItem[] = (d.messages ?? []).reverse(); // newest-first → oldest-first
        setMessages(msgs);
        setNextCursor(d.nextCursor ?? null);
        if (msgs.length > 0) {
          const sender = msgs[msgs.length - 1].sender;
          setParticipants((prev) =>
            prev.find((p) => p.id === sender.id) ? prev : [...prev, sender],
          );
        }
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "instant" }), 50);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [convId]);

  // Get conversation participants
  useEffect(() => {
    fetch(`${basePath}/api/conversations`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const conv = (d.conversations ?? []).find((c: { id: number }) => c.id === convId);
        if (conv) setParticipants(conv.participants ?? []);
      })
      .catch(() => {});
  }, [convId]);

  // ── WebSocket: incoming messages ──
  useEffect(() => {
    const off = onWsEvent((event) => {
      if (event.type === "message:new" && event.payload.conversationId === convId) {
        setMessages((prev) => {
          if (prev.find((m) => m.id === event.payload.id)) return prev;
          return [...prev, event.payload as MessageItem];
        });
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    });
    return off;
  }, [onWsEvent, convId]);

  // ── send message ──
  const sendMessage = async (type: "text" | "sticker", content?: string, stickerUrl?: string) => {
    if (type === "text" && !content?.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${basePath}/api/conversations/${convId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content, stickerUrl }),
      });
      if (!res.ok) return;
      const msg = await res.json() as MessageItem;
      setMessages((prev) => [...prev, msg]);
      setText("");
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim() && !sending) sendMessage("text", text);
  };

  // ── load more (scroll to top) ──
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const prevHeight = listRef.current?.scrollHeight ?? 0;
    try {
      const res = await fetch(
        `${basePath}/api/conversations/${convId}/messages?limit=30&cursor=${nextCursor}`,
        { credentials: "include" },
      );
      const d = await res.json();
      const older: MessageItem[] = (d.messages ?? []).reverse();
      setMessages((prev) => [...older, ...prev]);
      setNextCursor(d.nextCursor ?? null);
      // Preserve scroll position
      requestAnimationFrame(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight - prevHeight;
        }
      });
    } finally {
      setLoadingMore(false);
    }
  }, [convId, nextCursor, loadingMore]);

  const handleScroll = () => {
    if (listRef.current && listRef.current.scrollTop < 60) loadMore();
  };

  if (!convId) return null;

  return (
    <div className="flex flex-col h-full bg-[#0a0a12] text-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-3 border-b border-white/5 shrink-0 bg-[#0a0a12]">
        <button
          onClick={() => navigate("/messages")}
          className="p-2 -ml-2 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {other && (
          <>
            <Avatar src={other.avatarUrl} fallback={other.displayName} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-white truncate">
                {other.displayName || `@${other.username}`}
              </p>
              <p className="text-[11px] text-white/40">@{other.username}</p>
            </div>
          </>
        )}

        {other && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => initiateCall(other.id, other.username, "audio")}
              className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center text-white/60 hover:text-white transition-colors"
              title="Audio call"
            >
              <Phone className="w-4.5 h-4.5" />
            </button>
            <button
              onClick={() => initiateCall(other.id, other.username, "video")}
              className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center text-white/60 hover:text-white transition-colors"
              title="Video call"
            >
              <Video className="w-4.5 h-4.5" />
            </button>
          </div>
        )}
      </div>

      {/* Messages list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-1 min-h-0"
      >
        {loadingMore && (
          <div className="flex justify-center py-2">
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
          </div>
        )}
        {nextCursor && !loadingMore && (
          <button
            onClick={loadMore}
            className="w-full py-1.5 text-xs text-white/30 hover:text-white/60 transition-colors"
          >
            Load earlier messages
          </button>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-white/30 text-sm gap-2">
            <p>No messages yet</p>
            <p className="text-xs">Say hi! 👋</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isMine = msg.senderId === currentUserId;
            const isFirst = i === 0 || messages[i - 1].senderId !== msg.senderId;
            const isLast = i === messages.length - 1 || messages[i + 1].senderId !== msg.senderId;

            return (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isMine={isMine}
                isFirst={isFirst}
                isLast={isLast}
              />
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Sticker picker */}
      {showStickers && (
        <div className="absolute bottom-20 left-4 z-30">
          <StickerPicker
            onSelect={(url) => sendMessage("sticker", undefined, url)}
            onClose={() => setShowStickers(false)}
          />
        </div>
      )}

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 flex items-center gap-2 px-3 py-3 border-t border-white/5 bg-[#0a0a12]"
        onClick={() => setShowStickers(false)}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowStickers((s) => !s); }}
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0",
            showStickers ? "bg-primary text-white" : "text-white/40 hover:text-white hover:bg-white/5",
          )}
          title="Stickers"
        >
          <Smile className="w-5 h-5" />
        </button>

        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          maxLength={2000}
          className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-primary/50 transition-colors"
        />

        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="w-9 h-9 rounded-full bg-primary flex items-center justify-center transition-all disabled:opacity-30 disabled:scale-95 hover:bg-primary/80 shrink-0"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 text-white animate-spin" />
          ) : (
            <Send className="w-4 h-4 text-white" />
          )}
        </button>
      </form>
    </div>
  );
}

function MessageBubble({
  msg,
  isMine,
  isFirst,
  isLast,
}: {
  msg: MessageItem;
  isMine: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const isCall = msg.type === "call_audio" || msg.type === "call_video";
  const isSticker = msg.type === "sticker";

  if (isCall) {
    return (
      <div className={cn("flex items-center gap-2 my-1", isMine ? "justify-end" : "justify-start")}>
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-3 py-2">
          {msg.type === "call_video" ? (
            <Video className="w-4 h-4 text-white/50" />
          ) : (
            <Phone className="w-4 h-4 text-white/50" />
          )}
          <span className="text-white/70 text-xs">
            {msg.type === "call_video" ? "Video call" : "Audio call"}
            {" · "}
            {msg.callDuration ? formatDuration(msg.callDuration) : "Missed"}
          </span>
        </div>
      </div>
    );
  }

  if (isSticker) {
    return (
      <div className={cn("flex my-1", isMine ? "justify-end" : "justify-start")}>
        <img
          src={msg.stickerUrl ?? ""}
          alt="sticker"
          className="w-24 h-24 object-cover rounded-2xl"
        />
      </div>
    );
  }

  // Text message
  return (
    <div className={cn("flex", isMine ? "justify-end" : "justify-start", isFirst ? "mt-3" : "mt-0.5")}>
      <div
        className={cn(
          "max-w-[75%] px-3.5 py-2.5 text-sm leading-snug",
          isMine
            ? "bg-primary text-white"
            : "bg-white/10 text-white/90",
          // Rounded corners
          isMine
            ? cn(
                "rounded-2xl",
                isFirst && "rounded-tr-md",
                isLast && "rounded-br-md",
                !isFirst && !isLast && "rounded-r-md",
              )
            : cn(
                "rounded-2xl",
                isFirst && "rounded-tl-md",
                isLast && "rounded-bl-md",
                !isFirst && !isLast && "rounded-l-md",
              ),
        )}
      >
        <p className="break-words whitespace-pre-wrap">{msg.content}</p>
        {isLast && (
          <p className={cn("text-[9px] mt-1", isMine ? "text-white/50 text-right" : "text-white/30")}>
            {formatTime(msg.createdAt)}
          </p>
        )}
      </div>
    </div>
  );
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
