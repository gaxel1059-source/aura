import React, { useState, useEffect, useRef } from 'react';
import { Show } from '@clerk/react';
import { Redirect, Link } from 'wouter';
import { BottomNav } from '@/components/BottomNav';
import { Avatar } from '@/components/Avatar';
import { Search, Loader2, Play, Users } from 'lucide-react';
import { useSearchUsers, useGetFeed } from '@workspace/api-client-react';
import { basePath } from '@/lib/utils';

export default function ExplorePage() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const isSearching = debouncedQuery.trim().length > 0;

  return (
    <>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>

      <Show when="signed-in">
        <div className="min-h-full flex flex-col bg-background pb-[90px]">
          <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-xl border-b border-white/5 px-4 pt-12 pb-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className={`h-4 w-4 ${isSearching ? 'text-primary' : 'text-white/40'}`} />
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search creators..."
                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder-white/40 transition-all"
              />
              {query && (
                <button
                  onClick={() => { setQuery(''); setDebouncedQuery(''); }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-white/40 hover:text-white/70 text-lg leading-none"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {isSearching ? (
            <UserSearchResults query={debouncedQuery} />
          ) : (
            <VideoGrid />
          )}

          <BottomNav />
        </div>
      </Show>
    </>
  );
}

function UserSearchResults({ query }: { query: string }) {
  const { data, isLoading } = useSearchUsers({ q: query, limit: 20 });
  const users = data?.users ?? [];

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center pt-16">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center pt-16 px-6 text-center">
        <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mb-4">
          <Users className="w-6 h-6 text-white/30" />
        </div>
        <p className="text-white font-medium">No creators found</p>
        <p className="text-white/50 text-sm mt-1">Try a different name or username</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-white/5">
      {users.map((user) => (
        <Link key={user.id} href={`/profile/${user.username}`}>
          <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer">
            <Avatar src={user.avatarUrl} fallback={user.displayName} size="md" />
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm truncate">{user.displayName}</p>
              <p className="text-white/50 text-xs truncate">@{user.username}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-white/70 text-xs font-medium">{user.followersCount.toLocaleString()}</p>
              <p className="text-white/40 text-[10px]">followers</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function VideoGrid() {
  const { data, isLoading } = useGetFeed({ limit: 24 });
  const videos = data?.videos ?? [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-px mt-px">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="aspect-[3/4] bg-white/5 animate-pulse" />
        ))}
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center pt-20 px-6 text-center">
        <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mb-4">
          <Play className="w-6 h-6 text-white/30 ml-0.5" />
        </div>
        <p className="text-white font-medium">No content yet</p>
        <p className="text-white/50 text-sm mt-1">Be the first to upload a video</p>
      </div>
    );
  }

  return (
    <>
      <p className="px-4 pt-4 pb-2 text-white/40 text-xs font-medium uppercase tracking-wider">Recent</p>
      <div className="grid grid-cols-2 gap-px bg-white/5">
        {videos.map((video) => {
          const thumbSrc = video.thumbnailPath
            ? `${basePath}/api/storage/objects/${video.thumbnailPath.replace(/^\/objects\//, '')}`
            : null;

          return (
            <a key={video.id} href={`${basePath}/video/${video.id}`} className="aspect-[3/4] bg-black relative overflow-hidden group block">
              {thumbSrc ? (
                <img
                  src={thumbSrc}
                  alt={video.title || 'Video'}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/5">
                  <Play className="w-8 h-8 text-white/20 ml-1" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent pt-8 pb-1.5 px-2">
                <div className="flex items-center gap-1 text-[10px] text-white/80 font-medium">
                  <Play className="w-2.5 h-2.5 fill-white/80" />
                  <span>{(video.viewsCount || 0).toLocaleString()}</span>
                </div>
                <Link href={`/profile/${video.author?.username}`}>
                  <p className="text-white/60 text-[10px] truncate mt-0.5 hover:text-white/90 transition-colors">
                    @{video.author?.username}
                  </p>
                </Link>
              </div>
            </a>
          );
        })}
      </div>
    </>
  );
}
