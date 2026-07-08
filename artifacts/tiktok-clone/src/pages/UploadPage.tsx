import React, { useState, useRef } from 'react';
import { Show } from '@clerk/react';
import { Redirect, useLocation } from 'wouter';
import { useUpload } from '@workspace/object-storage-web';
import { useCreateVideo } from '@workspace/api-client-react';
import { BottomNav } from '@/components/BottomNav';
import { basePath } from '@/lib/utils';
import { UploadCloud, CheckCircle2, Loader2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/** Capture a JPEG thumbnail from a video File at ~10% of duration (min 1s) */
async function generateThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    const url = URL.createObjectURL(file);
    video.src = url;

    let settled = false;
    const cleanup = () => URL.revokeObjectURL(url);
    const done = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      cleanup();
      resolve(blob);
    };

    const draw = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxDim = 480;
        const ratio = Math.min(maxDim / (video.videoWidth || 480), maxDim / (video.videoHeight || 270), 1);
        canvas.width = Math.round((video.videoWidth || 480) * ratio);
        canvas.height = Math.round((video.videoHeight || 270) * ratio);
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => done(b), 'image/jpeg', 0.85);
      } catch { done(null); }
    };

    video.onseeked = draw;
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 1) * 0.1);
    };
    video.onerror = () => done(null);
    const timeoutId = setTimeout(() => done(null), 10_000);
  });
}

/** Upload a raw blob to object storage, return objectPath or null */
async function uploadBlob(blob: Blob, mimeType: string): Promise<string | null> {
  try {
    const urlRes = await fetch(`${basePath}/api/storage/uploads/request-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      // Backend expects { name, size, contentType }; returns { uploadURL, objectPath }
      body: JSON.stringify({ name: 'thumbnail.jpg', size: blob.size, contentType: mimeType }),
    });
    if (!urlRes.ok) return null;
    const { uploadURL, objectPath } = await urlRes.json() as { uploadURL: string; objectPath: string };
    const put = await fetch(uploadURL, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': mimeType },
    });
    return put.ok ? objectPath : null;
  } catch { return null; }
}

export default function UploadPage() {
  const [step, setStep] = useState<'pick' | 'details' | 'uploading' | 'success'>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailPathRef = useRef<string | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const createVideo = useCreateVideo();
  const { uploadFile, isUploading, progress } = useUpload({
    basePath: `${basePath}/api/storage`,
    onSuccess: async (response) => {
      try {
        await createVideo.mutateAsync({
          data: {
            videoPath: response.objectPath,
            thumbnailPath: thumbnailPathRef.current ?? undefined,
            title: title || undefined,
            description: description || undefined,
          },
        });
        setStep('success');
      } catch {
        toast({ variant: 'destructive', description: 'Failed to save video details.' });
        setStep('details');
      }
    },
    onError: (err) => {
      toast({ variant: 'destructive', description: err.message || 'Upload failed' });
      setStep('details');
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (selected.size > 500 * 1024 * 1024) {
        toast({ variant: 'destructive', description: 'File size exceeds 500MB limit.' });
        return;
      }
      setFile(selected);
      thumbnailPathRef.current = null;
      setStep('details');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && dropped.type.startsWith('video/')) {
      if (dropped.size > 500 * 1024 * 1024) {
        toast({ variant: 'destructive', description: 'File size exceeds 500MB limit.' });
        return;
      }
      setFile(dropped);
      thumbnailPathRef.current = null;
      setStep('details');
    } else {
      toast({ variant: 'destructive', description: 'Please drop a valid video file.' });
    }
  };

  const handlePost = async () => {
    if (!file) return;
    setStep('uploading');

    // Generate thumbnail first (non-fatal if it fails)
    try {
      const blob = await generateThumbnail(file);
      if (blob) {
        thumbnailPathRef.current = await uploadBlob(blob, 'image/jpeg');
      }
    } catch { /* thumbnail is optional */ }

    uploadFile(file);
  };

  return (
    <>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>

      <Show when="signed-in">
        <div className="min-h-[100dvh] flex flex-col bg-background relative pb-[90px]">
          <div className="flex justify-between items-center px-4 pt-12 pb-4 border-b border-white/5">
            <div className="w-8">
              {step === 'details' && (
                <button onClick={() => { setFile(null); setStep('pick'); }} className="text-white/70 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              )}
            </div>
            <h1 className="text-white font-semibold text-lg">Upload Video</h1>
            <div className="w-8" />
          </div>

          <div className="flex-1 flex flex-col px-4 py-6 overflow-y-auto hide-scrollbar">
            {step === 'pick' && (
              <div
                className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-3xl hover:border-primary/50 transition-colors bg-white/5 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mb-6">
                  <UploadCloud className="w-10 h-10 text-primary" />
                </div>
                <h2 className="text-white font-semibold text-lg mb-2">Select video to upload</h2>
                <p className="text-white/50 text-sm mb-8 text-center px-4">Or drag and drop a file</p>

                <div className="px-8 py-3.5 bg-primary hover:bg-primary/90 rounded-xl text-white font-semibold shadow-lg shadow-primary/20 transition-all">
                  Browse Files
                </div>
                <p className="text-white/40 text-xs mt-8">MP4, WebM, or OGG</p>
                <p className="text-white/40 text-xs mt-1">Up to 500MB</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="video/*"
                  onChange={handleFileSelect}
                />
              </div>
            )}

            {step === 'details' && (
              <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center gap-4 mb-8 p-4 rounded-2xl bg-white/5 border border-white/5">
                  <div className="w-14 h-14 bg-black/50 rounded-xl flex items-center justify-center overflow-hidden relative">
                    <UploadCloud className="w-6 h-6 text-white/50" />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-white text-sm font-medium truncate">{file?.name}</p>
                    <p className="text-white/50 text-xs mt-1">{(file?.size ? file.size / (1024 * 1024) : 0).toFixed(1)} MB</p>
                  </div>
                </div>

                <div className="space-y-6 flex-1">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-white/80 pl-1">Title (Optional)</label>
                    <input
                      type="text"
                      maxLength={200}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-2xl px-5 py-4 text-white text-sm focus:outline-none focus:border-primary transition-colors shadow-inner placeholder-white/30"
                      placeholder="Give your video a title..."
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-white/80 pl-1">Description (Optional)</label>
                    <textarea
                      maxLength={2000}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-2xl px-5 py-4 text-white text-sm focus:outline-none focus:border-primary transition-colors resize-none h-40 shadow-inner placeholder-white/30"
                      placeholder="Add #hashtags or mention @creators..."
                    />
                  </div>
                </div>

                <button
                  onClick={handlePost}
                  disabled={isUploading}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-2xl py-4 mt-8 transition-colors shadow-lg shadow-primary/20 flex items-center justify-center"
                >
                  Post to Aura
                </button>
              </div>
            )}

            {step === 'uploading' && (
              <div className="flex-1 flex flex-col items-center justify-center animate-in fade-in duration-500">
                <Loader2 className="w-16 h-16 text-primary animate-spin mb-8" />
                <h2 className="text-white font-semibold text-2xl mb-4">Uploading...</h2>
                <div className="w-full max-w-[280px] h-3 bg-white/10 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-white/60 font-medium text-lg">{Math.round(progress)}%</p>
                <p className="text-white/40 text-sm mt-4 text-center max-w-[250px]">
                  Please don't close this page while your video is uploading.
                </p>
              </div>
            )}

            {step === 'success' && (
              <div className="flex-1 flex flex-col items-center justify-center animate-in zoom-in-95 duration-500">
                <div className="w-24 h-24 bg-primary/20 rounded-full flex items-center justify-center mb-8 relative">
                  <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
                  <CheckCircle2 className="w-12 h-12 text-primary relative z-10" />
                </div>
                <h2 className="text-white font-semibold text-3xl mb-3">Video posted!</h2>
                <p className="text-white/50 text-base mb-10 text-center">Your moment is now live on Aura.</p>

                <div className="w-full space-y-4">
                  <button
                    onClick={() => setLocation('/feed')}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-2xl py-4 transition-colors text-center block shadow-lg shadow-primary/20"
                  >
                    View in Feed
                  </button>
                  <button
                    onClick={() => {
                      setFile(null);
                      setTitle('');
                      setDescription('');
                      thumbnailPathRef.current = null;
                      setStep('pick');
                    }}
                    className="w-full bg-white/5 hover:bg-white/10 text-white font-semibold rounded-2xl py-4 transition-colors"
                  >
                    Upload Another
                  </button>
                </div>
              </div>
            )}
          </div>

          <BottomNav />
        </div>
      </Show>
    </>
  );
}
