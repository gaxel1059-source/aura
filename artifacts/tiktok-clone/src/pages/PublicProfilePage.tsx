import React, { useState, useEffect } from 'react';
import { useParams, useLocation } from 'wouter';
import { BottomNav } from '@/components/BottomNav';
import { FollowListSheet } from '@/components/FollowListSheet';
import { useGetUserByUsername, useToggleFollow, useGetUserVideos, useGetMe } from '@workspace/api-client-react';
import { Avatar } from '@/components/Avatar';
import { ChevronLeft, Loader2, Play, MessageCircle, UserPlus, UserCheck, UserX } from 'lucide-react';
import { Link } from 'wouter';
import { cn, basePath } from '@/lib/utils';
import { useUser } from '@clerk/react';

type FollowSheet = 'followers' | 'following' | null;
type FriendStatus = 'none' | 'pending_sent' | 'pending_received' | 'accepted';

interface FriendStatusData {
  status: 'none' | 'pending' | 'accepted' | 'rejected';
  direction?: 'sent' | 'received';
  friendshipId?: number;
}

export default function PublicProfilePage() {
  const params = useParams();
  const username = params.username || '';
  const { isSignedIn } = useUser();
  const { data: me } = useGetMe();

  const { data: user, isLoading, error } = useGetUserByUsername(username);
  const toggleFollow = useToggleFollow();
  const [localFollowing, setLocalFollowing] = useState<boolean | null>(null);
  const [localFollowersCount, setLocalFollowersCount] = useState<number | null>(null);
  const [followSheet, setFollowSheet] = useState<FollowSheet>(null);

  // Friend request state
  const [friendStatus, setFriendStatus] = useState<FriendStatus>('none');
  const [friendshipId, setFriendshipId] = useState<number | null>(null);
  const [friendLoading, setFriendLoading] = useState(false);

  const isOwnProfile = me && user && me.id === user.id;
  const isFollowing = localFollowing !== null ? localFollowing : (user?.isFollowing ?? false);
  const followersCount = localFollowersCount !== null ? localFollowersCount : (user?.followersCount ?? 0);

  // Fetch friendship status once user data is available
  useEffect(() => {
    if (!isSignedIn || !user || isOwnProfile) return;
    fetch(`${basePath}/api/friends/status/${user.id}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d: FriendStatusData) => {
        if (d.status === 'accepted') setFriendStatus('accepted');
        else if (d.status === 'pending' && d.direction === 'sent') setFriendStatus('pending_sent');
        else if (d.status === 'pending' && d.direction === 'received') setFriendStatus('pending_received');
        else setFriendStatus('none');
        if (d.friendshipId) setFriendshipId(d.friendshipId);
      })
      .catch(() => {});
  }, [isSignedIn, user?.id, isOwnProfile]);

  const handleFollow = () => {
    if (!username) return;
    const wasFollowing = isFollowing;
    setLocalFollowing(!wasFollowing);
    setLocalFollowersCount(followersCount + (wasFollowing ? -1 : 1));
    toggleFollow.mutate(
      { username },
      {
        onSuccess: (data) => {
          setLocalFollowing(data.following);
          setLocalFollowersCount(data.followersCount);
        },
        onError: () => {
          setLocalFollowing(wasFollowing);
          setLocalFollowersCount(followersCount);
        },
      },
    );
  };

  const handleFriendRequest = async () => {
    if (!user) return;
    setFriendLoading(true);
    try {
      const res = await fetch(`${basePath}/api/friends/request`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (res.ok) {
        const data = await res.json() as { friendship: { id: number } };
        setFriendStatus('pending_sent');
        setFriendshipId(data.friendship.id);
      }
    } catch { /* ignore */ } finally {
      setFriendLoading(false);
    }
  };

  const handleAcceptRequest = async () => {
    if (!friendshipId) return;
    setFriendLoading(true);
    try {
      const res = await fetch(`${basePath}/api/friends/requests/${friendshipId}/accept`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) setFriendStatus('accepted');
    } catch { /* ignore */ } finally {
      setFriendLoading(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col bg-background pb-[90px]">
      <div className="flex items-center px-4 pt-12 pb-4 sticky top-0 bg-background/80 backdrop-blur-xl z-20 border-b border-white/5">
        <button
          onClick={() => window.history.back()}
          className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white transition-colors bg-white/5 rounded-full mr-4 shrink-0"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-white font-semibold text-lg flex-1 text-center pr-12 truncate">
          {user ? `@${user.username}` : ''}
        </h1>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : error || !user ? (
        <div className="flex-1 flex flex-col items-center justify-center text-white/50 px-6 text-center">
          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
            <span className="text-2xl">?</span>
          </div>
          <h2 className="text-lg font-medium text-white mb-2">User not found</h2>
          <p className="text-sm">This account doesn't exist or may have been removed.</p>
        </div>
      ) : (
        <div className="px-4">
          <div className="flex flex-col items-center mt-4">
            <Avatar
              src={user.avatarUrl}
              fallback={user.displayName}
              size="xl"
              className="mb-4 shadow-[0_0_30px_rgba(139,92,246,0.15)]"
            />
            <h2 className="text-xl font-bold text-white mb-1">{user.displayName}</h2>
            <p className="text-white/60 text-sm mb-4 max-w-[280px] text-center">
              {user.bio || 'This user prefers to keep an aura of mystery.'}
            </p>

            {/* Stats */}
            <div className="flex gap-8 mb-6">
              <button onClick={() => setFollowSheet('following')} className="flex flex-col items-center hover:opacity-80 transition-opacity">
                <span className="text-white font-bold text-lg">{user.followingCount}</span>
                <span className="text-white/50 text-xs">Siguiendo</span>
              </button>
              <button onClick={() => setFollowSheet('followers')} className="flex flex-col items-center hover:opacity-80 transition-opacity">
                <span className="text-white font-bold text-lg">{followersCount}</span>
                <span className="text-white/50 text-xs">Seguidores</span>
              </button>
              <div className="flex flex-col items-center">
                <span className="text-white font-bold text-lg">{user.likesCount}</span>
                <span className="text-white/50 text-xs">Likes</span>
              </div>
            </div>

            {/* Action buttons for other profiles */}
            {!isOwnProfile && isSignedIn && (
              <div className="flex gap-2 w-full max-w-[320px] flex-wrap justify-center">
                {/* Follow */}
                <button
                  onClick={handleFollow}
                  disabled={toggleFollow.isPending}
                  className={cn(
                    'flex-1 min-w-[90px] py-2.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 text-sm',
                    isFollowing
                      ? 'bg-white/10 text-white border border-white/20 hover:bg-white/15'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20',
                  )}
                >
                  {toggleFollow.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isFollowing ? 'Siguiendo' : 'Seguir'}
                </button>

                {/* Friend request */}
                <FriendButton
                  status={friendStatus}
                  loading={friendLoading}
                  onRequest={handleFriendRequest}
                  onAccept={handleAcceptRequest}
                />

                {/* Message */}
                <MessageButton userId={user.id} />
              </div>
            )}

            {isOwnProfile && (
              <Link href="/profile" className="w-full max-w-[240px] py-2.5 rounded-xl font-semibold bg-white/10 text-white text-center hover:bg-white/15 transition-colors">
                Editar perfil
              </Link>
            )}

            {/* Friend status pill */}
            {!isOwnProfile && isSignedIn && friendStatus === 'accepted' && (
              <div className="mt-2 flex items-center gap-1 text-xs text-emerald-400">
                <UserCheck className="w-3.5 h-3.5" />
                <span>Amigos</span>
              </div>
            )}
            {!isOwnProfile && isSignedIn && friendStatus === 'pending_sent' && (
              <div className="mt-2 flex items-center gap-1 text-xs text-white/40">
                <UserPlus className="w-3.5 h-3.5" />
                <span>Solicitud enviada</span>
              </div>
            )}
          </div>

          <div className="mt-8 border-t border-white/10">
            <PublicVideoGrid username={user.username} />
          </div>
        </div>
      )}

      {followSheet && user && (
        <FollowListSheet
          username={user.username}
          type={followSheet}
          onClose={() => setFollowSheet(null)}
        />
      )}

      <BottomNav />
    </div>
  );
}

// ── FriendButton ──────────────────────────────────────────────────────────────
function FriendButton({
  status,
  loading,
  onRequest,
  onAccept,
}: {
  status: FriendStatus;
  loading: boolean;
  onRequest: () => void;
  onAccept: () => void;
}) {
  if (status === 'accepted') return null; // shown via pill above

  if (status === 'pending_received') {
    return (
      <button
        onClick={onAccept}
        disabled={loading}
        className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all text-sm disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
        Aceptar
      </button>
    );
  }

  if (status === 'pending_sent') {
    return (
      <button
        disabled
        className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-semibold bg-white/5 text-white/30 border border-white/10 text-sm cursor-not-allowed"
      >
        <UserX className="w-4 h-4" />
        Pendiente
      </button>
    );
  }

  return (
    <button
      onClick={onRequest}
      disabled={loading}
      className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-semibold bg-white/10 text-white border border-white/20 hover:bg-white/15 transition-all text-sm disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
      Amigo
    </button>
  );
}

// ── MessageButton ─────────────────────────────────────────────────────────────
function MessageButton({ userId }: { userId: number }) {
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(false);

  const handleMessage = async (e: React.MouseEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${basePath}/api/conversations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json() as { id: number };
      navigate(`/messages/${data.id}`);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleMessage}
      disabled={loading}
      className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-semibold bg-white/10 text-white border border-white/20 hover:bg-white/15 transition-all text-sm disabled:opacity-50"
      title="Enviar mensaje"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
    </button>
  );
}

// ── PublicVideoGrid ───────────────────────────────────────────────────────────
function PublicVideoGrid({ username }: { username: string }) {
  const { data, isLoading } = useGetUserVideos(username);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  const videos = data?.videos ?? [];

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-white/40 gap-3">
        <Play className="w-12 h-12 text-white/20" />
        <p className="text-sm">No videos yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-0.5">
      {videos.map((video) => {
        const thumbSrc = video.thumbnailPath
          ? `${basePath}/api/storage/objects${video.thumbnailPath}`
          : null;
        return (
          <a key={video.id} href={`${basePath}/video/${video.id}`} className="aspect-[3/4] bg-white/5 relative cursor-pointer overflow-hidden block">
            {thumbSrc ? (
              <img src={thumbSrc} alt={video.title || 'Video'} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-black/40">
                <Play className="w-8 h-8 text-white/20 ml-1" />
              </div>
            )}
            <div className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/40 px-1.5 py-0.5 rounded text-[10px] text-white font-medium backdrop-blur-sm">
              <Play className="w-3 h-3 fill-white" />
              <span>{video.viewsCount || 0}</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}
