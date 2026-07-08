import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Show } from '@clerk/react';
import { Redirect, Link } from 'wouter';
import { useSyncMe, useGetFeed, useDeleteVideo, useGetMe } from '@workspace/api-client-react';
import type { Video } from '@workspace/api-client-react';
import { BottomNav } from '@/components/BottomNav';
import { basePath } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { VideoCard } from '@/components/VideoCard';
import { useToast } from '@/hooks/use-toast';

type FeedMode = 'for_you' | 'following';

export default function FeedPage() {
  const syncMe = useSyncMe();
  const { data: user } = useGetMe();
  const [mode, setMode] = useState<FeedMode>('for_you');

  useEffect(() => {
    syncMe.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>

      <Show when="signed-in">
        <div className="h-[100dvh] w-full bg-black relative">
          {/* Feed mode tabs — pinned over the video */}
          <div className="absolute top-0 inset-x-0 z-30 flex justify-center pt-12 pointer-events-none">
            <div className="flex gap-6 pointer-events-auto">
              <button
                onClick={() => setMode('for_you')}
                className={`text-sm font-semibold pb-1 transition-all ${
                  mode === 'for_you'
                    ? 'text-white border-b-2 border-white'
                    : 'text-white/50 border-b-2 border-transparent hover:text-white/70'
                }`}
              >
                For You
              </button>
              <button
                onClick={() => setMode('following')}
                className={`text-sm font-semibold pb-1 transition-all ${
                  mode === 'following'
                    ? 'text-white border-b-2 border-white'
                    : 'text-white/50 border-b-2 border-transparent hover:text-white/70'
                }`}
              >
                Following
              </button>
            </div>
          </div>

          <FeedScroller mode={mode} currentUserId={user?.id} />

          <BottomNav />
        </div>
      </Show>
    </>
  );
}

function FeedScroller({ mode, currentUserId }: { mode: FeedMode; currentUserId?: number }) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [activeVideoId, setActiveVideoId] = useState<number | null>(null);

  const { data: feedData, isLoading, isFetching } = useGetFeed({ limit: 5, cursor, mode });
  const deleteVideo = useDeleteVideo();
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Reset when mode changes
  useEffect(() => {
    setVideos([]);
    setCursor(undefined);
    setActiveVideoId(null);
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, [mode]);

  useEffect(() => {
    if (feedData?.videos && feedData.videos.length > 0) {
      setVideos((prev) => {
        const existingIds = new Set(prev.map((v) => v.id));
        const newVideos = feedData.videos.filter((v) => !existingIds.has(v.id));
        return [...prev, ...newVideos];
      });
    }
  }, [feedData]);

  useEffect(() => {
    if (videos.length > 0 && activeVideoId === null) {
      setActiveVideoId(videos[0].id);
    }
  }, [videos, activeVideoId]);

  const videoRef = useCallback((node: HTMLDivElement | null, id: number) => {
    if (!node) return;
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const vidId = Number(entry.target.getAttribute('data-video-id'));
              setActiveVideoId(vidId);
            }
          });
        },
        { root: containerRef.current, threshold: 0.6 },
      );
    }
    observerRef.current.observe(node);
  }, []);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    if (scrollHeight - scrollTop <= clientHeight * 1.5 && !isFetching && feedData?.nextCursor) {
      setCursor(feedData.nextCursor);
    }
  };

  const handleDelete = (id: number) => {
    deleteVideo.mutate({ id }, {
      onSuccess: () => {
        setVideos((prev) => prev.filter((v) => v.id !== id));
        toast({ description: 'Video deleted' });
      },
      onError: () => {
        toast({ variant: 'destructive', description: 'Failed to delete video' });
      },
    });
  };

  if (isLoading && videos.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center px-6 text-center pb-[80px]">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
        <p className="text-white/50 text-sm">Loading...</p>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center px-6 text-center z-10 pb-[80px]">
        <div className="flex flex-col items-center animate-in fade-in zoom-in duration-700">
          <img
            src={`${basePath}/logo.svg`}
            alt="Aura Logo"
            className="w-16 h-16 mb-8 opacity-80 drop-shadow-[0_0_15px_rgba(139,92,246,0.5)]"
          />
          {mode === 'following' ? (
            <>
              <h1 className="text-2xl font-semibold text-white mb-3">Follow some creators</h1>
              <p className="text-white/50 text-sm max-w-[260px] mb-8 leading-relaxed">
                Videos from people you follow will appear here. Explore Aura to find creators you love.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-white mb-3">Your feed is warming up</h1>
              <p className="text-white/50 text-sm max-w-[260px] mb-8 leading-relaxed">
                Be the first to upload. In the meantime, explore what's trending.
              </p>
            </>
          )}
          <Link
            href="/explore"
            className="px-6 py-3 rounded-full bg-white/10 text-white font-medium hover:bg-white/20 transition-colors border border-white/10"
          >
            Explore Aura
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-[100dvh] w-full overflow-y-scroll snap-y snap-mandatory hide-scrollbar relative bg-black"
      onScroll={handleScroll}
    >
      {videos.map((video) => (
        <div
          key={video.id}
          ref={(node) => videoRef(node, video.id)}
          data-video-id={video.id}
          className="h-[100dvh] w-full snap-start relative bg-black"
        >
          <VideoCard
            video={video}
            isActive={activeVideoId === video.id}
            currentUserId={currentUserId}
            onDelete={handleDelete}
          />
        </div>
      ))}
    </div>
  );
}
