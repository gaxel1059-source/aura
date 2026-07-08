import React from 'react';
import { useParams } from 'wouter';
import { useGetVideo, useDeleteVideo, useGetMe } from '@workspace/api-client-react';
import { VideoCard } from '@/components/VideoCard';
import { ChevronLeft, Loader2, Play } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'wouter';

export default function VideoPage() {
  const params = useParams();
  const id = Number(params.id);
  const { data: video, isLoading, error } = useGetVideo(id);
  const { data: user } = useGetMe();
  const deleteVideo = useDeleteVideo();
  const { toast } = useToast();

  const handleDelete = (videoId: number) => {
    deleteVideo.mutate({ id: videoId }, {
      onSuccess: () => {
        toast({ description: 'Video deleted' });
        window.history.back();
      },
      onError: () => {
        toast({ variant: 'destructive', description: 'Failed to delete video' });
      },
    });
  };

  if (isLoading) {
    return (
      <div className="h-[100dvh] w-full bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (error || !video || isNaN(id)) {
    return (
      <div className="h-[100dvh] w-full bg-black flex flex-col items-center justify-center text-center px-6">
        <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
          <Play className="w-7 h-7 text-white/30 ml-0.5" />
        </div>
        <h2 className="text-white font-semibold text-lg mb-2">Video not found</h2>
        <p className="text-white/50 text-sm mb-6">This video may have been removed.</p>
        <Link href="/feed" className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold">
          Back to Feed
        </Link>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full bg-black relative">
      {/* Back button */}
      <button
        onClick={() => window.history.back()}
        className="absolute top-12 left-4 z-50 w-9 h-9 bg-black/60 backdrop-blur-sm rounded-full flex items-center justify-center text-white border border-white/10 hover:bg-black/80 transition-colors"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <VideoCard
        video={video}
        isActive={true}
        currentUserId={user?.id}
        onDelete={handleDelete}
      />
    </div>
  );
}
