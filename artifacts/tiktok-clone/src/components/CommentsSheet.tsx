import React, { useState, useRef, useEffect } from 'react';
import { useGetComments, useAddComment, useDeleteComment } from '@workspace/api-client-react';
import type { Comment } from '@workspace/api-client-react';
import { X, Send, Loader2, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { cn } from '@/lib/utils';

interface CommentsSheetProps {
  videoId: number;
  isOpen: boolean;
  onClose: () => void;
  currentUserId?: number;
  onCommentAdded?: () => void;
  onCommentDeleted?: () => void;
}

export function CommentsSheet({
  videoId,
  isOpen,
  onClose,
  currentUserId,
  onCommentAdded,
  onCommentDeleted,
}: CommentsSheetProps) {
  const [text, setText] = useState('');
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [allComments, setAllComments] = useState<Comment[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useGetComments(videoId, { limit: 20, cursor }, {
    query: {
      // Refetch every 5s while the sheet is open so other users' comments appear
      refetchInterval: isOpen ? 5000 : false,
      staleTime: 0,
    },
  });

  // Append comments when new page loads
  useEffect(() => {
    if (!data?.comments) return;
    if (cursor === undefined) {
      setAllComments(data.comments);
    } else {
      setAllComments(prev => {
        const ids = new Set(prev.map(c => c.id));
        return [...prev, ...data.comments.filter(c => !ids.has(c.id))];
      });
    }
  }, [data]);

  // Reset when opening for a different video
  useEffect(() => {
    if (isOpen) {
      setCursor(undefined);
      setAllComments([]);
    }
  }, [isOpen, videoId]);

  const addComment = useAddComment();
  const deleteComment = useDeleteComment();

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || addComment.isPending) return;

    addComment.mutate(
      { id: videoId, data: { text: trimmed } },
      {
        onSuccess: (newComment) => {
          setText('');
          setAllComments(prev => [newComment, ...prev]);
          onCommentAdded?.();
        },
      },
    );
  };

  const handleDelete = (commentId: number) => {
    deleteComment.mutate(
      { id: videoId, commentId },
      {
        onSuccess: () => {
          setAllComments(prev => prev.filter(c => c.id !== commentId));
          onCommentDeleted?.();
        },
      },
    );
  };

  const hasNextPage = !!data?.nextCursor;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 transition-opacity duration-300",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className={cn(
          "fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-50 flex flex-col",
          "bg-[#0f0f14] rounded-t-3xl border-t border-white/10",
          "transition-transform duration-300 ease-out",
          isOpen ? "translate-y-0" : "translate-y-full",
        )}
        style={{ maxHeight: '75dvh' }}
      >
        {/* Handle + header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
          <div className="absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1 bg-white/20 rounded-full" />
          <h3 className="text-white font-semibold text-sm pt-2">Comments</h3>
          <button onClick={onClose} className="p-2 -mr-2 text-white/50 hover:text-white transition-colors rounded-full hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Comments list */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4 min-h-0">
          {isLoading && allComments.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : allComments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-white/40">
              <EmptyBubbleIcon className="w-10 h-10 mb-2" />
              <p className="text-sm">No comments yet. Be the first!</p>
            </div>
          ) : (
            <>
              {allComments.map((comment) => (
                <div key={comment.id} className="flex gap-3 group">
                  <Avatar
                    src={comment.author?.avatarUrl}
                    fallback={comment.author?.displayName ?? '?'}
                    size="sm"
                    className="shrink-0 mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-white/80 font-semibold text-xs">@{comment.author?.username}</span>
                      <span className="text-white/30 text-[10px]">{formatRelative(comment.createdAt)}</span>
                    </div>
                    <p className="text-white/90 text-sm mt-0.5 leading-snug break-words">{comment.text}</p>
                  </div>
                  {comment.userId === currentUserId && (
                    <button
                      onClick={() => handleDelete(comment.id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 p-1 text-white/30 hover:text-destructive transition-all rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {hasNextPage && (
                <button
                  onClick={() => setCursor(data?.nextCursor ?? undefined)}
                  disabled={isLoading}
                  className="w-full py-2 text-white/40 text-xs hover:text-white/60 transition-colors"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-white/5 flex gap-3 items-center shrink-0 bg-[#0a0a12]">
          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={currentUserId ? "Add a comment…" : "Sign in to comment"}
            disabled={!currentUserId || addComment.isPending}
            maxLength={500}
            className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!text.trim() || !currentUserId || addComment.isPending}
            className="w-9 h-9 rounded-full bg-primary flex items-center justify-center transition-all disabled:opacity-30 disabled:scale-95 hover:bg-primary/80 shrink-0"
          >
            {addComment.isPending ? (
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </button>
        </form>
      </div>
    </>
  );
}

function EmptyBubbleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.556 0 8.25-3.694 8.25-8.25S16.556 3.75 12 3.75 3.75 7.444 3.75 12c0 1.698.516 3.278 1.4 4.584L3.75 20.25l3.666-1.35A8.21 8.21 0 0012 20.25z" />
    </svg>
  );
}

function formatRelative(dateStr: string | Date): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}
