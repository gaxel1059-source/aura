import React, { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { MessageCircle, Bell, ChevronRight, Loader2, Search, UserPlus } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { Avatar } from "@/components/Avatar";
import { basePath, cn } from "@/lib/utils";
import { useGetNotifications } from "@workspace/api-client-react";

interface ConversationSummary {
  id: number;
  isRequest: boolean;
  participants: { id: number; username: string; displayName: string; avatarUrl: string | null }[];
  lastMessage: {
    type: string;
    content: string | null;
    stickerUrl: string | null;
    senderId: number;
    createdAt: string;
  } | null;
  unreadCount: number;
}

type Tab = "chats" | "requests" | "activity";

function lastMessagePreview(msg: ConversationSummary["lastMessage"]): string {
  if (!msg) return "No messages yet";
  if (msg.type === "sticker") return "🎨 Sticker";
  if (msg.type === "call_audio") return "📞 Audio call";
  if (msg.type === "call_video") return "📹 Video call";
  return msg.content ?? "";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function MessagesPage() {
  const [tab, setTab] = useState<Tab>("chats");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, isLoaded } = useUser();

  const { data: notifData, isLoading: notifLoading } = useGetNotifications({});

  const fetchConversations = useCallback(() => {
    if (!user) return;
    fetch(`${basePath}/api/conversations`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchConversations();
  }, [user, fetchConversations]);

  if (!isLoaded) return null;

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-white/60 px-8 text-center">
        <MessageCircle className="w-12 h-12 text-white/20" />
        <p className="text-sm">Sign in to see your messages</p>
        <Link href="/sign-in">
          <button className="px-6 py-2.5 bg-primary rounded-2xl text-white text-sm font-semibold">Sign in</button>
        </Link>
      </div>
    );
  }

  const chats = conversations.filter((c) => !c.isRequest);
  const requests = conversations.filter((c) => c.isRequest);
  const requestCount = requests.reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), requests.length > 0 ? 0 : 0);

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "chats", label: "Mensajes" },
    { key: "requests", label: "Solicitudes", badge: requests.length },
    { key: "activity", label: "Actividad" },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0a0a12] text-white">
      {/* Header */}
      <div className="px-4 pt-12 pb-0 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Mensajes</h1>
          <Link href="/explore">
            <button className="p-2 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-colors">
              <Search className="w-5 h-5" />
            </button>
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex-1 py-3 text-sm font-semibold transition-colors border-b-2 -mb-px flex items-center justify-center gap-1.5",
                tab === t.key
                  ? "text-white border-primary"
                  : "text-white/40 border-transparent hover:text-white/70",
              )}
            >
              {t.label}
              {!!t.badge && t.badge > 0 && (
                <span className="min-w-[16px] h-4 px-1 bg-primary rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                  {t.badge > 9 ? "9+" : t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "chats" && (
          <ChatsList conversations={chats} loading={loading} onRefresh={fetchConversations} />
        )}
        {tab === "requests" && (
          <RequestsList conversations={requests} loading={loading} onRefresh={fetchConversations} />
        )}
        {tab === "activity" && (
          <ActivityTab data={notifData} loading={notifLoading} />
        )}
      </div>

      <BottomNav />
    </div>
  );
}

// ── ChatsList ─────────────────────────────────────────────────────────────────
function ChatsList({
  conversations,
  loading,
  onRefresh,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  onRefresh: () => void;
}) {
  useEffect(() => {
    const id = setInterval(onRefresh, 10000);
    return () => clearInterval(id);
  }, [onRefresh]);

  if (loading && conversations.length === 0) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-white/40 px-8 text-center gap-3">
        <MessageCircle className="w-12 h-12 text-white/20" />
        <p className="text-sm">Sin conversaciones aún</p>
        <p className="text-xs text-white/30">Visita el perfil de alguien para iniciar una conversación</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-white/5">
      {conversations.map((conv) => <ConvRow key={conv.id} conv={conv} />)}
    </div>
  );
}

// ── RequestsList ──────────────────────────────────────────────────────────────
function RequestsList({
  conversations,
  loading,
  onRefresh,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  onRefresh: () => void;
}) {
  useEffect(() => {
    const id = setInterval(onRefresh, 10000);
    return () => clearInterval(id);
  }, [onRefresh]);

  if (loading && conversations.length === 0) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-white/40 px-8 text-center gap-3">
        <UserPlus className="w-12 h-12 text-white/20" />
        <p className="text-sm">Sin solicitudes de mensaje</p>
        <p className="text-xs text-white/30">Cuando alguien que no es tu amigo te escriba, aparecerá aquí</p>
      </div>
    );
  }

  return (
    <div>
      <p className="px-4 pt-4 pb-2 text-xs text-white/40">
        Puedes aceptar mensajes de personas que no conoces. Solo tú puedes ver estas solicitudes.
      </p>
      <div className="divide-y divide-white/5">
        {conversations.map((conv) => <ConvRow key={conv.id} conv={conv} isRequest />)}
      </div>
    </div>
  );
}

// ── Shared ConvRow ────────────────────────────────────────────────────────────
function ConvRow({ conv, isRequest }: { conv: ConversationSummary; isRequest?: boolean }) {
  const other = conv.participants[0];
  if (!other) return null;
  return (
    <Link href={`/messages/${conv.id}`}>
      <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors cursor-pointer">
        <div className="relative shrink-0">
          <Avatar src={other.avatarUrl} fallback={other.displayName} size="md" />
          {conv.unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-primary rounded-full text-[9px] font-bold text-white flex items-center justify-center px-0.5">
              {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm text-white truncate">
              {other.displayName || `@${other.username}`}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {isRequest && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-semibold">
                  Solicitud
                </span>
              )}
              {conv.lastMessage && (
                <span className="text-[10px] text-white/30">{timeAgo(conv.lastMessage.createdAt)}</span>
              )}
            </div>
          </div>
          <p className={cn("text-xs truncate mt-0.5", conv.unreadCount > 0 ? "text-white font-medium" : "text-white/40")}>
            {lastMessagePreview(conv.lastMessage)}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-white/20 shrink-0" />
      </div>
    </Link>
  );
}

// ── ActivityTab ───────────────────────────────────────────────────────────────
function ActivityTab({ data, loading }: { data: unknown; loading: boolean }) {
  const notifs = (data as { notifications?: unknown[] })?.notifications ?? [];

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;
  }

  if (notifs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-white/40 gap-3">
        <Bell className="w-12 h-12 text-white/20" />
        <p className="text-sm">Sin actividad aún</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <Link href="/notifications">
        <div className="flex items-center justify-between py-3 hover:opacity-70 transition-opacity">
          <span className="text-sm font-semibold text-primary">Ver toda la actividad</span>
          <ChevronRight className="w-4 h-4 text-primary" />
        </div>
      </Link>
    </div>
  );
}
