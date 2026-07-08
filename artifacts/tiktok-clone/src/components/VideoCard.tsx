import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRecordView, useToggleLike } from '@workspace/api-client-react';
import type { Video } from '@workspace/api-client-react';
import { Heart, MessageCircle, Share2, Trash2, Play, Volume2, Volume1, VolumeX } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Link } from 'wouter';
import { cn, basePath } from '@/lib/utils';
import { CommentsSheet } from '@/components/CommentsSheet';

interface VideoCardProps {
  video: Video;
  isActive: boolean;
  currentUserId?: number;
  onDelete: (id: number) => void;
}

export function VideoCard({ video, isActive, currentUserId, onDelete }: VideoCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlayIndicator, setShowPlayIndicator] = useState(false);
  const recordView = useRecordView();
  const hasRecordedView = useRef(false);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [showSlider, setShowSlider] = useState(false);
  const volumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Progress bar state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timers on unmount
  useEffect(() => () => {
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
  }, []);

  const [expanded, setExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);

  // Like state — initialised from server, then managed locally for instant feedback
  const [liked, setLiked] = useState(video.isLiked ?? false);
  const [likesCount, setLikesCount] = useState(video.likesCount);
  const [commentsCount, setCommentsCount] = useState(video.commentsCount);
  const toggleLike = useToggleLike();

  // Sync server state when video object changes (e.g. after feed refresh)
  useEffect(() => {
    setLiked(video.isLiked ?? false);
    setLikesCount(video.likesCount);
  }, [video.isLiked, video.likesCount]);

  useEffect(() => {
    setCommentsCount(video.commentsCount);
  }, [video.commentsCount]);

  useEffect(() => {
    if (isActive) {
      videoRef.current?.play().catch(() => {});
      setIsPlaying(true);
      if (!hasRecordedView.current) {
        recordView.mutate({ id: video.id });
        hasRecordedView.current = true;
      }
    } else {
      videoRef.current?.pause();
      setIsPlaying(false);
      setCurrentTime(0);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
      }
    }
    // recordView intentionally omitted — it's a mutation callback that may not
    // be reference-stable across renders; including it re-ran this effect (and
    // re-called .play()) on every unrelated re-render, overriding manual pause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, video.id]);

  // Sync volume + muted to the underlying <video> element imperatively
  // (React's muted prop is an attribute, not a property — must set both)
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = isMuted;
  }, [volume, isMuted]);

  // --- Progress bar helpers ---
  const flashProgress = useCallback(() => {
    setShowProgress(true);
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    progressTimerRef.current = setTimeout(() => setShowProgress(false), 2500);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) setDuration(videoRef.current.duration || 0);
  }, []);

  const handleSeek = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const el = videoRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = pct * duration;
    flashProgress();
  }, [duration, flashProgress]);

  // --- Playback ---
  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
      setShowPlayIndicator(true);
      setTimeout(() => setShowPlayIndicator(false), 500);
    }
    flashProgress();
  }, [isPlaying, flashProgress]);

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (!nextMuted) {
      setShowSlider(true);
      scheduleHideSlider();
    }
  };

  const scheduleHideSlider = () => {
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
    volumeTimerRef.current = setTimeout(() => setShowSlider(false), 3000);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const v = parseFloat(e.target.value);
    setVolume(v);
    setIsMuted(v === 0);
    scheduleHideSlider();
  };

  const handleVolumeAreaEnter = () => {
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
    setShowSlider(true);
  };

  const handleVolumeAreaLeave = () => {
    scheduleHideSlider();
  };

  const handleShare = async () => {
    const url = `${window.location.origin}${basePath}/feed?video=${video.id}`;
    if (navigator.share) {
      await navigator.share({
        title: video.title || 'Aura Video',
        text: video.description || 'Check out this video on Aura!',
        url,
      });
    } else {
      navigator.clipboard.writeText(url);
    }
  };

  const handleLike = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || toggleLike.isPending) return;
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikesCount(c => wasLiked ? Math.max(0, c - 1) : c + 1);

    toggleLike.mutate(
      { id: video.id },
      {
        onSuccess: (data) => {
          setLiked(data.liked);
          setLikesCount(data.likesCount);
        },
        onError: () => {
          setLiked(wasLiked);
          setLikesCount(c => wasLiked ? c + 1 : Math.max(0, c - 1));
        },
      },
    );
  }, [liked, video.id, toggleLike, currentUserId]);

  const videoSrc = `${basePath}/api/storage/objects/${video.videoPath.replace(/^\/objects\//, '')}`;
  const thumbnailUrl = video.thumbnailPath
    ? `${basePath}/api/storage/objects/${video.thumbnailPath.replace(/^\/objects\//, '')}`
    : undefined;

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <div
        className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden"
        onPointerMove={isActive ? flashProgress : undefined}
      >
        <video
          ref={videoRef}
          src={videoSrc}
          poster={thumbnailUrl}
          className="w-full h-full object-cover"
          loop
          playsInline
          muted={isMuted}
          onClick={togglePlay}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
        />

        {/* Play/Pause Indicator */}
        {showPlayIndicator && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="bg-black/40 rounded-full p-4 animate-in zoom-in fade-in duration-300">
              {isPlaying ? (
                <Play className="w-12 h-12 text-white fill-white" />
              ) : (
                <div className="w-12 h-12 flex items-center justify-center">
                  <div className="w-4 h-12 bg-white rounded-full mx-1" />
                  <div className="w-4 h-12 bg-white rounded-full mx-1" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Volume Control */}
        {isActive && (
          <div
            className="absolute top-16 left-4 z-20 flex items-center gap-2"
            onClick={e => e.stopPropagation()}
            onMouseEnter={handleVolumeAreaEnter}
            onMouseLeave={handleVolumeAreaLeave}
          >
            <button
              onClick={toggleMute}
              className="bg-black/50 backdrop-blur-md p-2.5 rounded-full text-white hover:bg-black/70 transition-all active:scale-95"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon className="w-5 h-5" />
            </button>

            <div
              className={cn(
                "transition-all duration-200 overflow-hidden flex items-center",
                showSlider || !isMuted ? "w-24 opacity-100" : "w-0 opacity-0",
              )}
            >
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                onClick={e => e.stopPropagation()}
                className="w-full h-1 appearance-none bg-white/30 rounded-full cursor-pointer accent-white"
                aria-label="Volume"
              />
            </div>
          </div>
        )}

        {/* Right Overlay */}
        <div className="absolute right-4 bottom-[120px] flex flex-col items-center gap-6 z-20">
          <Link href={`/profile/${video.author?.username ?? ''}`} className="relative flex flex-col items-center">
            <div className="rounded-full p-[2px] bg-white">
              <Avatar
                src={video.author?.avatarUrl}
                fallback={video.author?.displayName ?? '?'}
                size="md"
                className="border-2 border-black"
              />
            </div>
          </Link>

          {/* Like button */}
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={handleLike}
              className={cn(
                "w-12 h-12 rounded-full bg-black/20 flex items-center justify-center backdrop-blur-sm transition-all",
                liked ? "text-rose-500 scale-110" : "text-white hover:text-rose-400",
              )}
            >
              <Heart className={cn("w-7 h-7 transition-all", liked ? "fill-rose-500" : "fill-white/20")} />
            </button>
            <span className="text-white font-semibold text-xs drop-shadow-md">{likesCount}</span>
          </div>

          {/* Comment button */}
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); setCommentsOpen(true); }}
              className="w-12 h-12 rounded-full bg-black/20 flex items-center justify-center backdrop-blur-sm text-white hover:text-primary transition-colors"
            >
              <MessageCircle className="w-7 h-7 fill-white/20" />
            </button>
            <span className="text-white font-semibold text-xs drop-shadow-md">{commentsCount}</span>
          </div>

          {/* Share */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={handleShare} className="w-12 h-12 rounded-full bg-black/20 flex items-center justify-center backdrop-blur-sm text-white hover:text-primary transition-colors">
              <Share2 className="w-7 h-7" />
            </button>
            <span className="text-white font-semibold text-xs drop-shadow-md">Share</span>
          </div>

          {video.userId === currentUserId && (
            <div className="flex flex-col items-center gap-1">
              <button onClick={() => onDelete(video.id)} className="w-12 h-12 rounded-full bg-black/20 flex items-center justify-center backdrop-blur-sm text-white hover:text-destructive transition-colors">
                <Trash2 className="w-6 h-6" />
              </button>
            </div>
          )}
        </div>

        {/* Bottom Overlay */}
        <div className="absolute bottom-0 left-0 right-0 pt-24 pb-[90px] px-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent z-10 pointer-events-none">
          <Link href={`/profile/${video.author?.username ?? ''}`} className="pointer-events-auto inline-block">
            <h3 className="text-white font-semibold text-lg drop-shadow-md mb-1">@{video.author?.username}</h3>
          </Link>
          {video.title && (
            <p className="text-white/90 font-medium text-sm drop-shadow-md mb-1 pointer-events-auto">{video.title}</p>
          )}
          {video.description && (
            <div className="pointer-events-auto">
              <p className={cn("text-white/80 text-sm drop-shadow-md", !expanded && "line-clamp-2")}>
                {video.description}
              </p>
              {video.description.length > 80 && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="text-white font-semibold text-sm drop-shadow-md mt-1"
                >
                  {expanded ? "less" : "more"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Progress bar — always visible while active */}
        {isActive && duration > 0 && (
          <div
            className="absolute bottom-0 left-0 right-0 z-30 h-8 flex items-end px-1 pb-1 cursor-pointer"
            onClick={e => e.stopPropagation()}
            onPointerDown={handleSeek}
            onPointerMove={(e) => { if (e.buttons > 0) handleSeek(e); }}
          >
            <div className="w-full h-[3px] bg-white/25 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Comments Sheet */}
      <CommentsSheet
        videoId={video.id}
        isOpen={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        currentUserId={currentUserId}
        onCommentAdded={() => setCommentsCount(c => c + 1)}
        onCommentDeleted={() => setCommentsCount(c => Math.max(0, c - 1))}
      />
    </>
  );
}
