import React, { useEffect, useState } from 'react';
import { Show } from '@clerk/react';
import { Redirect } from 'wouter';
import {
  useGetNotifications,
  useMarkAllNotificationsRead,
  useGetUnreadNotificationCount,
  getGetUnreadNotificationCountQueryKey,
} from '@workspace/api-client-react';
import type { Notification } from '@workspace/api-client-react';
import { BottomNav } from '@/components/BottomNav';
import { Avatar } from '@/components/Avatar';
import { Loader2, Heart, UserPlus, MessageCircle, Users, Check, X } from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { cn, basePath } from '@/lib/utils';

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const markAllRead = useMarkAllNotificationsRead();

  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [allNotifications, setAllNotifications] = useState<Notification[]>([]);
  const [handledRequests, setHandledRequests] = useState<Set<number>>(new Set());

  const { data, isLoading } = useGetNotifications({ limit: 20, cursor });

  useEffect(() => {
    if (!data?.notifications) return;
    if (cursor === undefined) {
      setAllNotifications(data.notifications);
    } else {
      setAllNotifications((prev) => {
        const ids = new Set(prev.map((n) => n.id));
        return [...prev, ...data.notifications.filter((n) => !ids.has(n.id))];
      });
    }
  }, [data]);

  const hasNextPage = !!data?.nextCursor;

  useEffect(() => {
    markAllRead.mutate(undefined, {
      onSuccess: () => {
        queryClient.setQueryData(getGetUnreadNotificationCountQueryKey(), { count: 0 });
        setAllNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFriendRequest = async (notif: Notification, action: 'accept' | 'reject') => {
    // The notification's actorId is the requester; we need the friendship ID
    // Fetch friendship status to get the ID
    try {
      const statusRes = await fetch(`${basePath}/api/friends/status/${notif.actor?.id}`, { credentials: 'include' });
      const statusData = await statusRes.json() as { status: string; friendshipId?: number };
      if (!statusData.friendshipId) return;

      const endpoint = action === 'accept'
        ? `/api/friends/requests/${statusData.friendshipId}/accept`
        : `/api/friends/requests/${statusData.friendshipId}/reject`;

      await fetch(`${basePath}${endpoint}`, { method: 'POST', credentials: 'include' });
      setHandledRequests((prev) => new Set(prev).add(notif.id));
    } catch { /* ignore */ }
  };

  return (
    <>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>

      <Show when="signed-in">
        <div className="min-h-[100dvh] flex flex-col bg-background pb-[90px]">
          <div className="flex items-center justify-center px-4 pt-12 pb-4 sticky top-0 bg-background/80 backdrop-blur-xl z-20 border-b border-white/5">
            <h1 className="text-white font-semibold text-lg">Notificaciones</h1>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading && allNotifications.length === 0 ? (
              <div className="flex justify-center py-16">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : allNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <BellIcon className="w-8 h-8 text-white/20" />
                </div>
                <h2 className="text-white font-semibold mb-2">Sin notificaciones</h2>
                <p className="text-white/40 text-sm max-w-[240px]">
                  Cuando alguien le dé like, te siga o comente, lo verás aquí.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {allNotifications.map((notif) => (
                  <NotificationRow
                    key={notif.id}
                    notification={notif}
                    handled={handledRequests.has(notif.id)}
                    onFriendAction={handleFriendRequest}
                  />
                ))}
                {hasNextPage && (
                  <div className="flex justify-center py-4">
                    <button
                      onClick={() => setCursor(data?.nextCursor ?? undefined)}
                      disabled={isLoading}
                      className="text-white/40 text-sm hover:text-white/60 transition-colors"
                    >
                      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Cargar más'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <BottomNav />
        </div>
      </Show>
    </>
  );
}

function NotificationRow({
  notification,
  handled,
  onFriendAction,
}: {
  notification: Notification;
  handled: boolean;
  onFriendAction: (notif: Notification, action: 'accept' | 'reject') => void;
}) {
  const { type, actor, read, createdAt, videoTitle, videoId } = notification;
  const [pending, setPending] = useState(false);

  const isFriendRequest = type === 'friend_request';
  const isFriendAccept = type === 'friend_accept';

  const icon =
    type === 'like' ? (
      <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />
    ) : type === 'follow' ? (
      <UserPlus className="w-4 h-4 text-primary" />
    ) : type === 'friend_request' ? (
      <Users className="w-4 h-4 text-violet-300" />
    ) : type === 'friend_accept' ? (
      <Users className="w-4 h-4 text-emerald-400" />
    ) : (
      <MessageCircle className="w-4 h-4 text-sky-400 fill-sky-400/20" />
    );

  const message =
    type === 'like' ? (
      <>le dio like a tu video{videoTitle ? <span className="text-white/60">: "{videoTitle}"</span> : ''}</>
    ) : type === 'follow' ? (
      <>empezó a seguirte</>
    ) : type === 'friend_request' ? (
      <>te envió una solicitud de amistad</>
    ) : type === 'friend_accept' ? (
      <>aceptó tu solicitud de amistad</>
    ) : (
      <>comentó en tu video{videoTitle ? <span className="text-white/60">: "{videoTitle}"</span> : ''}</>
    );

  const href =
    type === 'follow' || type === 'friend_request' || type === 'friend_accept'
      ? `/profile/${actor?.username ?? ''}`
      : videoId
      ? `/video/${videoId}`
      : '/feed';

  const handleAction = async (action: 'accept' | 'reject') => {
    setPending(true);
    await onFriendAction(notification, action);
    setPending(false);
  };

  return (
    <div className={cn('flex items-start gap-3 px-4 py-3.5', !read && 'bg-primary/5')}>
      <Link href={href} className="shrink-0">
        <div className="relative">
          <Avatar src={actor?.avatarUrl} fallback={actor?.displayName ?? '?'} size="md" />
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#0f0f14] flex items-center justify-center border border-white/10">
            {icon}
          </div>
        </div>
      </Link>

      <div className="flex-1 min-w-0">
        <Link href={href}>
          <p className="text-sm text-white/90 leading-snug hover:opacity-80 transition-opacity">
            <span className="font-semibold">@{actor?.username}</span>{' '}
            {message}
          </p>
        </Link>
        <p className="text-xs text-white/30 mt-0.5">{formatRelative(createdAt)}</p>

        {/* Friend request action buttons */}
        {isFriendRequest && !handled && (
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => handleAction('accept')}
              disabled={pending}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Aceptar
            </button>
            <button
              onClick={() => handleAction('reject')}
              disabled={pending}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 text-white/70 text-xs font-semibold hover:bg-white/15 transition-colors disabled:opacity-50"
            >
              <X className="w-3 h-3" />
              Rechazar
            </button>
          </div>
        )}
        {isFriendRequest && handled && (
          <p className="text-xs text-white/30 mt-1.5">Solicitud procesada</p>
        )}
        {isFriendAccept && (
          <Link href={`/profile/${actor?.username ?? ''}`}>
            <button className="mt-2 px-3 py-1.5 rounded-lg bg-white/10 text-white/70 text-xs font-semibold hover:bg-white/15 transition-colors">
              Ver perfil
            </button>
          </Link>
        )}
      </div>

      {!read && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
    </div>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

function formatRelative(dateStr: string | Date): string {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days}d`;
  return date.toLocaleDateString();
}
