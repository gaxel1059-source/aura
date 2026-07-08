import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Show } from '@clerk/react';
import { Redirect } from 'wouter';
import { BottomNav } from '@/components/BottomNav';
import { FollowListSheet } from '@/components/FollowListSheet';
import {
  useGetMe, useUpdateMe, useGetUserVideos,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useUpload } from '@workspace/object-storage-web';
import { Avatar } from '@/components/Avatar';
import { Settings, Loader2, X, Play, Camera, Plus, FileText, Bookmark, Trash2, Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { basePath } from '@/lib/utils';
import { cn } from '@/lib/utils';

type FollowSheet = 'followers' | 'following' | null;

// ─── Types ──────────────────────────────────────────────────────────────────

interface Story {
  id: number;
  userId: number;
  mediaPath: string;
  mediaType: string;
  createdAt: string;
  expiresAt: string;
  viewed: boolean;
}

interface HighlightItem {
  id: number;
  highlightId: number;
  mediaPath: string;
  mediaType: string;
  addedAt: string;
}

interface Highlight {
  id: number;
  userId: number;
  title: string;
  coverPath: string | null;
  createdAt: string;
  items: HighlightItem[];
}

// Resolve storage media path to a full URL
export function storageSrc(path: string): string {
  const clean = path.replace(/^\/objects\//, '');
  return `${basePath}/api/storage/objects/${clean}`;
}

// ─── Profile Page ─────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { data: user, isLoading } = useGetMe();
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [followSheet, setFollowSheet] = useState<FollowSheet>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [storyViewer, setStoryViewer] = useState<Story | null>(null);
  const [activeTab, setActiveTab] = useState<'videos' | 'liked'>('videos');
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightViewer, setHighlightViewer] = useState<Highlight | null>(null);
  const [addToHighlightStory, setAddToHighlightStory] = useState<Story | null>(null);

  // Load own stories
  useEffect(() => {
    if (!user) return;
    fetch(`${basePath}/api/stories/user/${user.id}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { stories: [] })
      .then((d) => setStories(d.stories ?? []))
      .catch(() => {});
  }, [user?.id]);

  // Load highlights
  useEffect(() => {
    if (!user) return;
    fetch(`${basePath}/api/highlights/user/${user.id}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { highlights: [] })
      .then((d) => setHighlights(d.highlights ?? []))
      .catch(() => {});
  }, [user?.id]);

  return (
    <>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>

      <Show when="signed-in">
        <div className="min-h-[100dvh] flex flex-col bg-background pb-[90px] overflow-y-auto hide-scrollbar">
          {/* Header */}
          <div className="flex justify-between items-center px-4 pt-12 pb-3 sticky top-0 bg-background/90 backdrop-blur-xl z-20">
            <div className="w-8" />
            <h1 className="text-white font-semibold text-base tracking-tight">{user?.username || 'Profile'}</h1>
            <button className="w-8 h-8 flex items-center justify-center text-white/60 hover:text-white transition-colors">
              <Settings className="w-5 h-5" />
            </button>
          </div>

          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : !user ? (
            <div className="flex-1 flex items-center justify-center text-white/50">Failed to load profile</div>
          ) : (
            <div className="flex flex-col">
              {/* ── Instagram-style profile header ─────────────── */}
              <div className="px-4 pt-3 pb-4">
                {/* Row: Avatar + Stats */}
                <div className="flex items-center gap-4 mb-3">
                  {/* Story ring + avatar */}
                  <div className="relative shrink-0">
                    <button
                      onClick={() => stories.length > 0 ? setStoryViewer(stories[0]) : undefined}
                      className="block"
                    >
                      <div className={cn(
                        "p-[2px] rounded-full",
                        stories.length > 0
                          ? "bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600"
                          : "bg-transparent",
                      )}>
                        <div className="p-[2px] bg-background rounded-full">
                          <Avatar
                            src={user.avatarUrl}
                            fallback={user.displayName}
                            size="xl"
                            className="w-[82px] h-[82px]"
                          />
                        </div>
                      </div>
                    </button>
                    {/* Camera overlay for upload */}
                    <AvatarUploadButton avatarUrl={user.avatarUrl} displayName={user.displayName} />
                  </div>

                  {/* Stats */}
                  <div className="flex-1 flex justify-around">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-white font-bold text-lg leading-tight">{user.likesCount}</span>
                      <span className="text-white/50 text-xs">Likes</span>
                    </div>
                    <button
                      onClick={() => setFollowSheet('followers')}
                      className="flex flex-col items-center gap-0.5 hover:opacity-80 transition-opacity"
                    >
                      <span className="text-white font-bold text-lg leading-tight">{user.followersCount}</span>
                      <span className="text-white/50 text-xs">Seguidores</span>
                    </button>
                    <button
                      onClick={() => setFollowSheet('following')}
                      className="flex flex-col items-center gap-0.5 hover:opacity-80 transition-opacity"
                    >
                      <span className="text-white font-bold text-lg leading-tight">{user.followingCount}</span>
                      <span className="text-white/50 text-xs">Siguiendo</span>
                    </button>
                  </div>
                </div>

                {/* Name + Note */}
                <div className="mb-2">
                  <p className="text-white font-semibold text-sm">{user.displayName}</p>
                  {user.note ? (
                    <div className="mt-1 flex items-start gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-white/40 mt-0.5 shrink-0" />
                      <p className="text-white/70 text-xs leading-relaxed">{user.note}</p>
                    </div>
                  ) : null}
                  {user.bio ? (
                    <p className="text-white/70 text-sm mt-1 leading-snug">{user.bio}</p>
                  ) : null}
                </div>

                {/* Edit Profile button */}
                <button
                  onClick={() => setIsEditing(true)}
                  className="w-full py-2 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 transition-colors border border-white/10"
                >
                  Editar perfil
                </button>
              </div>

              {/* ── Stories + Nota row ──────────────────────────── */}
              <StoriesRow
                userId={user.id}
                stories={stories}
                note={user.note ?? null}
                onStoryAdded={(story) => setStories((prev) => [story, ...prev])}
                onViewStory={setStoryViewer}
                onEditNote={() => setIsEditingNote(true)}
              />

              {/* ── Destacadas row ───────────────────────────────── */}
              <HighlightsRow
                highlights={highlights}
                onView={setHighlightViewer}
                onHighlightCreated={(h) => setHighlights((prev) => [...prev, h])}
                onHighlightDeleted={(id) => setHighlights((prev) => prev.filter((h) => h.id !== id))}
              />

              {/* ── Tabs ─────────────────────────────────────────── */}
              <div className="flex border-b border-white/10">
                <button
                  onClick={() => setActiveTab('videos')}
                  className={cn(
                    "flex-1 py-3 text-sm font-medium transition-colors",
                    activeTab === 'videos' ? "text-white border-b-2 border-white" : "text-white/40 hover:text-white/70",
                  )}
                >
                  Videos
                </button>
                <button
                  onClick={() => setActiveTab('liked')}
                  className={cn(
                    "flex-1 py-3 text-sm font-medium transition-colors",
                    activeTab === 'liked' ? "text-white border-b-2 border-white" : "text-white/40 hover:text-white/70",
                  )}
                >
                  ❤ Gustados
                </button>
              </div>

              {/* ── Video Grid ──────────────────────────────────── */}
              {activeTab === 'videos'
                ? <ProfileVideoGrid username={user.username} />
                : <LikedVideoGrid />
              }
            </div>
          )}

          {isEditing && user && (
            <EditProfileModal user={user} onClose={() => setIsEditing(false)} />
          )}

          {isEditingNote && user && (
            <NoteEditModal
              currentNote={user.note ?? ''}
              onClose={() => setIsEditingNote(false)}
            />
          )}

          {followSheet && user && (
            <FollowListSheet
              username={user.username}
              type={followSheet}
              onClose={() => setFollowSheet(null)}
            />
          )}

          {storyViewer && (
            <StoryViewerModal
              story={storyViewer}
              stories={stories}
              onClose={() => setStoryViewer(null)}
              onNext={(story) => setStoryViewer(story)}
              onAddToHighlight={(s) => setAddToHighlightStory(s)}
            />
          )}

          {highlightViewer && (
            <HighlightViewerModal
              highlight={highlightViewer}
              onClose={() => setHighlightViewer(null)}
            />
          )}

          {addToHighlightStory && (
            <AddToHighlightModal
              story={addToHighlightStory}
              highlights={highlights}
              onClose={() => setAddToHighlightStory(null)}
              onHighlightCreated={(h) => { setHighlights((prev) => [...prev, h]); setAddToHighlightStory(null); }}
              onItemAdded={() => setAddToHighlightStory(null)}
            />
          )}

          <BottomNav />
        </div>
      </Show>
    </>
  );
}

// ─── Avatar Upload Button ──────────────────────────────────────────────────────

function AvatarUploadButton({ avatarUrl, displayName }: { avatarUrl: string | null; displayName: string }) {
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { uploadFile } = useUpload({
    basePath: `${basePath}/api/storage`,
    onSuccess: async (response) => {
      try {
        const updated = await updateMe.mutateAsync({ data: { avatarUrl: response.objectPath } });
        queryClient.setQueryData(getGetMeQueryKey(), updated);
        toast({ description: 'Foto actualizada' });
      } catch {
        toast({ variant: 'destructive', description: 'Error al guardar foto' });
      } finally {
        setUploading(false);
      }
    },
    onError: (err) => {
      toast({ variant: 'destructive', description: err.message || 'Error de subida' });
      setUploading(false);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast({ variant: 'destructive', description: 'Selecciona una imagen' }); return; }
    if (file.size > 10 * 1024 * 1024) { toast({ variant: 'destructive', description: 'Máximo 10MB' }); return; }
    setUploading(true);
    uploadFile(file);
    e.target.value = '';
  };

  return (
    <>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="absolute bottom-0 right-0 w-6 h-6 bg-primary rounded-full flex items-center justify-center border-2 border-background hover:bg-primary/90 transition-colors disabled:opacity-60 shadow-lg"
      >
        {uploading ? <Loader2 className="w-3 h-3 text-white animate-spin" /> : <Camera className="w-3 h-3 text-white" />}
      </button>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
    </>
  );
}

// ─── Stories Row ──────────────────────────────────────────────────────────────

function StoriesRow({
  userId,
  stories,
  note,
  onStoryAdded,
  onViewStory,
  onEditNote,
}: {
  userId: number;
  stories: Story[];
  note: string | null;
  onStoryAdded: (s: Story) => void;
  onViewStory: (s: Story) => void;
  onEditNote: () => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Track the actual media type of the file being uploaded so we send the correct value to the API
  const uploadingFileType = useRef<'image' | 'video'>('image');

  const { uploadFile } = useUpload({
    basePath: `${basePath}/api/storage`,
    onSuccess: async (response) => {
      try {
        const r = await fetch(`${basePath}/api/stories`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaPath: response.objectPath, mediaType: uploadingFileType.current }),
        });
        if (!r.ok) throw new Error('failed');
        const data = await r.json() as { story: Story };
        onStoryAdded(data.story);
        toast({ description: 'Historia publicada ✓' });
      } catch {
        toast({ variant: 'destructive', description: 'Error al publicar historia' });
      } finally { setUploading(false); }
    },
    onError: () => { toast({ variant: 'destructive', description: 'Error de subida' }); setUploading(false); },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      toast({ variant: 'destructive', description: 'Selecciona una imagen o video' }); return;
    }
    uploadingFileType.current = file.type.startsWith('video/') ? 'video' : 'image';
    setUploading(true);
    uploadFile(file);
    e.target.value = '';
  };

  return (
    <div className="px-4 py-3 border-b border-white/5">
      <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
        {/* Note bubble — always first */}
        <button
          onClick={onEditNote}
          className="flex flex-col items-center gap-1.5 shrink-0"
        >
          <div className="relative w-16">
            {/* speech bubble */}
            <div className="bg-white/10 border border-white/15 rounded-2xl px-2 py-1.5 min-h-[44px] flex items-center justify-center text-center hover:bg-white/15 transition-colors">
              <span className={cn("text-[10px] leading-tight break-all line-clamp-3", note ? "text-white/80" : "text-white/30 italic")}>
                {note || "¿En qué piensas?"}
              </span>
            </div>
            {/* bubble tail */}
            <div className="absolute -bottom-[7px] left-1/2 -translate-x-1/2 w-3 h-3 bg-white/10 border-b border-r border-white/15 rotate-45" />
          </div>
          <span className="text-white/50 text-[10px] mt-1">Nota</span>
        </button>

        {/* Add story button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex flex-col items-center gap-1.5 shrink-0"
        >
          <div className="w-16 h-16 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors relative">
            {uploading ? (
              <Loader2 className="w-5 h-5 text-white/60 animate-spin" />
            ) : (
              <Plus className="w-5 h-5 text-white/60" />
            )}
          </div>
          <span className="text-white/50 text-[10px]">Nueva</span>
        </button>
        <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileChange} />

        {/* Existing stories */}
        {stories.map((story) => (
          <button
            key={story.id}
            onClick={() => onViewStory(story)}
            className="flex flex-col items-center gap-1.5 shrink-0"
          >
            <div className={cn(
              "p-[2px] rounded-full",
              story.viewed ? "bg-white/20" : "bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600",
            )}>
              <div className="p-[2px] bg-background rounded-full">
                <div
                  className="w-[56px] h-[56px] rounded-full overflow-hidden bg-white/10"
                  style={{
                    backgroundImage: story.mediaType === 'image'
                      ? `url(${basePath}/api/storage/objects/${story.mediaPath.replace(/^\/objects\//, '')})`
                      : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
              </div>
            </div>
            <span className="text-white/50 text-[10px]">
              {new Date(story.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Story Viewer Modal ──────────────────────────────────────────────────────

function StoryViewerModal({
  story,
  stories,
  onClose,
  onNext,
  onAddToHighlight,
}: {
  story: Story;
  stories: Story[];
  onClose: () => void;
  onNext: (s: Story) => void;
  onAddToHighlight?: (s: Story) => void;
}) {
  const idx = stories.findIndex((s) => s.id === story.id);
  const src = `${basePath}/api/storage/objects/${story.mediaPath.replace(/^\/objects\//, '')}`;

  const advance = useCallback(() => {
    if (idx < stories.length - 1) onNext(stories[idx + 1]);
    else onClose();
  }, [idx, stories, onNext, onClose]);

  // For images: auto-advance after 5 seconds. For videos: advance on ended.
  useEffect(() => {
    if (story.mediaType !== 'image') return;
    const t = setTimeout(advance, 5000);
    return () => clearTimeout(t);
  }, [story.id, story.mediaType, advance]);

  // Mark as viewed
  useEffect(() => {
    fetch(`${basePath}/api/stories/${story.id}/view`, { method: 'POST', credentials: 'include' }).catch(() => {});
  }, [story.id]);

  return (
    <div className="fixed inset-0 z-[200] bg-black" onClick={onClose}>
      {/* Progress segments */}
      <div className="absolute top-10 left-2 right-2 flex gap-1 z-10">
        {stories.map((s, i) => (
          <div key={s.id} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full bg-white rounded-full",
                i < idx ? "w-full" : i === idx && story.mediaType === 'image' ? "w-0 [animation:grow_5s_linear_forwards]" : "w-0",
              )}
            />
          </div>
        ))}
      </div>

      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-14 right-4 z-10 w-8 h-8 flex items-center justify-center text-white/70"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Media */}
      {story.mediaType === 'image' ? (
        <img src={src} alt="Story" className="w-full h-full object-contain" onClick={(e) => e.stopPropagation()} />
      ) : (
        <video
          src={src}
          autoPlay
          playsInline
          className="w-full h-full object-contain"
          onEnded={advance}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {/* "Añadir a Destacadas" button */}
      {onAddToHighlight && (
        <button
          onClick={(e) => { e.stopPropagation(); onAddToHighlight(story); }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-white/15 backdrop-blur-sm border border-white/20 text-white text-sm font-semibold px-5 py-2.5 rounded-2xl hover:bg-white/25 transition-colors"
        >
          <Bookmark className="w-4 h-4" />
          Añadir a Destacadas
        </button>
      )}

      {/* Nav areas */}
      <div className="absolute inset-0 flex z-5">
        <div className="w-1/3 h-full" onClick={(e) => { e.stopPropagation(); if (idx > 0) onNext(stories[idx - 1]); }} />
        <div className="w-1/3 h-full" />
        <div className="w-1/3 h-full" onClick={(e) => { e.stopPropagation(); if (idx < stories.length - 1) onNext(stories[idx + 1]); else onClose(); }} />
      </div>
    </div>
  );
}

// ─── Highlights Row ───────────────────────────────────────────────────────────

function HighlightsRow({
  highlights,
  onView,
  onHighlightCreated,
  onHighlightDeleted,
}: {
  highlights: Highlight[];
  onView: (h: Highlight) => void;
  onHighlightCreated: (h: Highlight) => void;
  onHighlightDeleted: (id: number) => void;
}) {
  if (highlights.length === 0) return null;

  return (
    <div className="px-4 pt-4 pb-3 border-b border-white/5">
      <p className="text-white/50 text-xs font-semibold mb-3 tracking-wide uppercase">Destacadas</p>
      <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-1">
        {highlights.map((h) => {
          const cover = h.coverPath ? storageSrc(h.coverPath) : null;
          return (
            <button
              key={h.id}
              onClick={() => h.items.length > 0 ? onView(h) : undefined}
              className="flex flex-col items-center gap-1.5 shrink-0 group"
            >
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-white/20 bg-white/5 group-hover:border-white/40 transition-colors">
                {cover ? (
                  <img src={cover} alt={h.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Bookmark className="w-5 h-5 text-white/30" />
                  </div>
                )}
              </div>
              <span className="text-white/70 text-[10px] max-w-[64px] truncate text-center">{h.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Highlight Viewer Modal ───────────────────────────────────────────────────

function HighlightViewerModal({ highlight, onClose }: { highlight: Highlight; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const item = highlight.items[idx];
  if (!item) return null;
  const src = storageSrc(item.mediaPath);
  const count = highlight.items.length;

  const advance = useCallback(() => {
    if (idx < count - 1) setIdx(idx + 1);
    else onClose();
  }, [idx, count, onClose]);

  useEffect(() => {
    if (item.mediaType !== 'image') return;
    const t = setTimeout(advance, 5000);
    return () => clearTimeout(t);
  }, [item.id, item.mediaType, advance]);

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col" onClick={onClose}>
      {/* Progress */}
      <div className="absolute top-10 left-2 right-2 flex gap-1 z-10">
        {highlight.items.map((it, i) => (
          <div key={it.id} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
            <div className={cn("h-full bg-white rounded-full", i < idx ? "w-full" : i === idx && item.mediaType === 'image' ? "w-0 [animation:grow_5s_linear_forwards]" : "w-0")} />
          </div>
        ))}
      </div>
      {/* Title */}
      <div className="absolute top-14 left-4 z-10 flex items-center gap-2">
        <span className="text-white font-semibold text-sm">{highlight.title}</span>
      </div>
      {/* Close */}
      <button onClick={onClose} className="absolute top-14 right-4 z-10 w-8 h-8 flex items-center justify-center text-white/70">
        <X className="w-5 h-5" />
      </button>
      {/* Media */}
      {item.mediaType === 'image' ? (
        <img src={src} alt="highlight" className="w-full h-full object-contain" onClick={(e) => e.stopPropagation()} />
      ) : (
        <video src={src} autoPlay playsInline className="w-full h-full object-contain" onEnded={advance} onClick={(e) => e.stopPropagation()} />
      )}
      {/* Nav */}
      <div className="absolute inset-0 flex z-5">
        <div className="w-1/3 h-full" onClick={(e) => { e.stopPropagation(); if (idx > 0) setIdx(idx - 1); }} />
        <div className="w-1/3 h-full" />
        <div className="w-1/3 h-full" onClick={(e) => { e.stopPropagation(); advance(); }} />
      </div>
    </div>
  );
}

// ─── Add to Highlight Modal ───────────────────────────────────────────────────

function AddToHighlightModal({
  story,
  highlights,
  onClose,
  onHighlightCreated,
  onItemAdded,
}: {
  story: Story;
  highlights: Highlight[];
  onClose: () => void;
  onHighlightCreated: (h: Highlight) => void;
  onItemAdded: () => void;
}) {
  const { toast } = useToast();
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);

  const createNew = async () => {
    const title = newTitle.trim() || 'Destacada';
    setCreating(true);
    try {
      const r = await fetch(`${basePath}/api/highlights`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, mediaPath: story.mediaPath, mediaType: story.mediaType }),
      });
      if (!r.ok) throw new Error('failed');
      const data = await r.json() as { highlight: Highlight };
      onHighlightCreated(data.highlight);
      toast({ description: `Destacada "${title}" creada` });
    } catch {
      toast({ variant: 'destructive', description: 'Error al crear destacada' });
    } finally { setCreating(false); }
  };

  const addToExisting = async (highlightId: number) => {
    setAdding(highlightId);
    try {
      const r = await fetch(`${basePath}/api/highlights/${highlightId}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaPath: story.mediaPath, mediaType: story.mediaType }),
      });
      if (!r.ok) throw new Error('failed');
      onItemAdded();
      toast({ description: 'Añadido a la destacada' });
    } catch {
      toast({ variant: 'destructive', description: 'Error al añadir' });
    } finally { setAdding(null); }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-[430px] bg-card rounded-t-3xl border-t border-white/10 p-6 animate-in slide-in-from-bottom-full duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-white">Añadir a Destacadas</h3>
          <button onClick={onClose} className="p-1 text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {/* Existing highlights */}
        {highlights.length > 0 && (
          <div className="mb-4">
            <p className="text-white/50 text-xs mb-3">Destacadas existentes</p>
            <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2">
              {highlights.map((h) => {
                const cover = h.coverPath ? storageSrc(h.coverPath) : null;
                return (
                  <button
                    key={h.id}
                    onClick={() => addToExisting(h.id)}
                    disabled={adding === h.id}
                    className="flex flex-col items-center gap-1 shrink-0 opacity-100 hover:opacity-70 transition-opacity disabled:opacity-40"
                  >
                    <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white/20 bg-white/5 flex items-center justify-center">
                      {adding === h.id ? (
                        <Loader2 className="w-4 h-4 text-white animate-spin" />
                      ) : cover ? (
                        <img src={cover} alt={h.title} className="w-full h-full object-cover" />
                      ) : (
                        <Bookmark className="w-4 h-4 text-white/30" />
                      )}
                    </div>
                    <span className="text-white/70 text-[10px] max-w-[56px] truncate">{h.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Create new */}
        <p className="text-white/50 text-xs mb-2">Nueva destacada</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nombre (ej: Viajes)"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
          />
          <button
            onClick={createNew}
            disabled={creating}
            className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Note Edit Modal ──────────────────────────────────────────────────────────

function NoteEditModal({ currentNote, onClose }: { currentNote: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe();
  const { toast } = useToast();
  const [note, setNote] = useState(currentNote);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const save = () => {
    updateMe.mutate(
      { data: { note: note || undefined } },
      {
        onSuccess: (u) => { queryClient.setQueryData(getGetMeQueryKey(), u); toast({ description: 'Nota guardada' }); onClose(); },
        onError: () => { toast({ variant: 'destructive', description: 'Error al guardar nota' }); },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-[430px] bg-card rounded-t-3xl border-t border-white/10 p-6 animate-in slide-in-from-bottom-full duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold text-white">¿En qué estás pensando?</h3>
          <button onClick={onClose} className="p-1 text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="relative mb-4">
          <input
            ref={inputRef}
            type="text"
            value={note}
            maxLength={60}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Escribe algo..."
            className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-primary pr-12"
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-white/30">{60 - note.length}</span>
        </div>
        <button
          onClick={save}
          disabled={updateMe.isPending}
          className="w-full bg-primary text-white font-semibold rounded-2xl py-3.5 transition-colors hover:bg-primary/90 flex items-center justify-center"
        >
          {updateMe.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Guardar nota'}
        </button>
      </div>
    </div>
  );
}

// ─── Liked Video Grid ─────────────────────────────────────────────────────────

function LikedVideoGrid() {
  const [videos, setVideos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`${basePath}/api/videos/liked?limit=30`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { videos: [] })
      .then((d) => setVideos(d.videos ?? []))
      .catch(() => setVideos([]))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="pt-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="pt-16 flex flex-col items-center justify-center px-4 text-white/40 gap-3">
        <span className="text-3xl">♡</span>
        <p className="text-sm font-medium text-white/60">Sin videos gustados</p>
        <p className="text-xs text-center max-w-[200px]">Los videos que te gusten aparecerán aquí</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-[1px]">
      {videos.map((video: any) => {
        const thumbSrc = video.thumbnailPath
          ? `${basePath}/api/storage/objects/${video.thumbnailPath.replace(/^\/objects\//, '')}`
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

// ─── Video Grid ────────────────────────────────────────────────────────────────

function ProfileVideoGrid({ username }: { username: string }) {
  const { data, isLoading } = useGetUserVideos(username, { limit: 30 });
  const videos = data?.videos ?? [];

  if (isLoading) {
    return (
      <div className="pt-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="pt-16 flex flex-col items-center justify-center px-4 text-white/40 gap-3">
        <Play className="w-12 h-12 text-white/15" />
        <p className="text-sm font-medium text-white/60">Sin videos todavía</p>
        <p className="text-xs text-center max-w-[200px]">Sube tu primer video para compartir tus momentos</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-[1px]">
      {videos.map((video) => {
        const thumbSrc = video.thumbnailPath
          ? `${basePath}/api/storage/objects/${video.thumbnailPath.replace(/^\/objects\//, '')}`
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

// ─── Edit Profile Modal ────────────────────────────────────────────────────────

function EditProfileModal({ user, onClose }: { user: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateMe = useUpdateMe();

  const [formData, setFormData] = useState({
    displayName: user.displayName || '',
    username: user.username || '',
    bio: user.bio || '',
    note: user.note || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMe.mutate(
      { data: { ...formData, note: formData.note || undefined } },
      {
        onSuccess: (updatedUser) => {
          queryClient.setQueryData(getGetMeQueryKey(), updatedUser);
          toast({ description: 'Perfil actualizado' });
          onClose();
        },
        onError: () => {
          toast({ variant: 'destructive', description: 'Error al actualizar perfil' });
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full max-w-[430px] bg-card rounded-t-3xl sm:rounded-2xl border-t sm:border border-white/10 p-6 animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-8 duration-300">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-white">Editar perfil</h3>
          <button onClick={onClose} className="p-2 -mr-2 text-white/50 hover:text-white rounded-full hover:bg-white/5 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Nombre">
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-primary transition-colors"
              placeholder="Tu nombre"
            />
          </Field>
          <Field label="Usuario">
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-primary transition-colors"
              placeholder="nombre_usuario"
            />
          </Field>
          <Field label="Nota (máx. 60 caracteres)">
            <input
              type="text"
              value={formData.note}
              maxLength={60}
              onChange={(e) => setFormData({ ...formData, note: e.target.value })}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-primary transition-colors"
              placeholder="¿En qué estás pensando?"
            />
          </Field>
          <Field label="Bio">
            <textarea
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-primary transition-colors resize-none h-24"
              placeholder="Cuéntanos un poco sobre ti..."
            />
          </Field>
          <button
            type="submit"
            disabled={updateMe.isPending}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl py-4 mt-2 transition-colors flex items-center justify-center shadow-lg shadow-primary/20"
          >
            {updateMe.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Guardar cambios'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-white/60 pl-1">{label}</label>
      {children}
    </div>
  );
}
