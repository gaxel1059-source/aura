import React, { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { useGetUserFollowers, useGetUserFollowing } from '@workspace/api-client-react';
import type { UserProfile } from '@workspace/api-client-react';
import { Avatar } from '@/components/Avatar';
import { X, Loader2, Users } from 'lucide-react';

interface FollowListSheetProps {
  username: string;
  type: 'followers' | 'following';
  onClose: () => void;
}

export function FollowListSheet({ username, type, onClose }: FollowListSheetProps) {
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  const followersResult = useGetUserFollowers(username, { limit: 20, cursor });
  const followingResult = useGetUserFollowing(username, { limit: 20, cursor });
  const { data, isLoading } = type === 'followers' ? followersResult : followingResult;

  // Reset when switching type or username
  useEffect(() => {
    setAllUsers([]);
    setCursor(undefined);
  }, [username, type]);

  useEffect(() => {
    if (!data?.users) return;
    if (cursor === undefined) {
      setAllUsers(data.users);
    } else {
      setAllUsers((prev) => {
        const ids = new Set(prev.map((u) => u.id));
        return [...prev, ...data.users.filter((u) => !ids.has(u.id))];
      });
    }
  }, [data]);

  const title = type === 'followers' ? 'Followers' : 'Following';
  const hasMore = !!data?.nextCursor;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[75dvh] flex flex-col bg-[#0f0f14] rounded-t-3xl border-t border-white/10 animate-in slide-in-from-bottom-full duration-300">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <h3 className="text-white font-semibold text-base">{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/60 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto hide-scrollbar">
          {isLoading && allUsers.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : allUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
                <Users className="w-5 h-5 text-white/30" />
              </div>
              <p className="text-white/60 text-sm">
                {type === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/5 pb-8">
              {allUsers.map((user) => (
                <Link key={user.id} href={`/profile/${user.username}`} onClick={onClose}>
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer">
                    <Avatar src={user.avatarUrl} fallback={user.displayName} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{user.displayName}</p>
                      <p className="text-white/50 text-xs truncate">@{user.username}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-white/60 text-xs">{user.followersCount.toLocaleString()}</p>
                      <p className="text-white/30 text-[10px]">followers</p>
                    </div>
                  </div>
                </Link>
              ))}

              {hasMore && (
                <div className="flex justify-center py-4">
                  <button
                    onClick={() => setCursor(data?.nextCursor ?? undefined)}
                    disabled={isLoading}
                    className="text-white/40 text-sm hover:text-white/60 transition-colors"
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Load more'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
