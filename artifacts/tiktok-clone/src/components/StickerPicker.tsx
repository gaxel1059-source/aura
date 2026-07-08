import React, { useState, useRef } from "react";
import { X, Plus, Loader2, Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import { basePath } from "@/lib/utils";

interface Sticker {
  id: number;
  imageUrl: string;
  name: string | null;
}

interface StickerPickerProps {
  onSelect: (stickerUrl: string) => void;
  onClose: () => void;
}

export function StickerPicker({ onSelect, onClose }: StickerPickerProps) {
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    fetch(`${basePath}/api/stickers`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setStickers(d.stickers ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("Image must be under 5MB");
      return;
    }

    setUploading(true);
    try {
      // 1. Get presigned upload URL
      const urlRes = await fetch(`${basePath}/api/storage/uploads/request-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!urlRes.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await urlRes.json() as { uploadURL: string; objectPath: string };

      // 2. Upload to GCS
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");

      // The object path from GCS goes through our proxy
      const imageUrl = `${basePath}/api/storage/objects/${objectPath.replace(/^\/objects\//, "")}`;

      // 3. Create sticker record
      const stickerRes = await fetch(`${basePath}/api/stickers`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, name: file.name.replace(/\.[^.]+$/, "") }),
      });
      if (!stickerRes.ok) throw new Error("Failed to save sticker");
      const newSticker = await stickerRes.json() as Sticker;
      setStickers((prev) => [newSticker, ...prev]);
    } catch (err) {
      console.error(err);
      alert("Failed to create sticker. Try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="bg-[#0f0f1a] rounded-2xl border border-white/10 shadow-2xl overflow-hidden w-72">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
        <div className="flex items-center gap-1.5">
          <Smile className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-white">My Stickers</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Grid */}
      <div className="p-2 max-h-52 overflow-y-auto">
        {!loaded ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            {/* Add new sticker button */}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="aspect-square rounded-xl border-2 border-dashed border-white/20 hover:border-primary/60 flex items-center justify-center transition-colors group"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              ) : (
                <Plus className="w-5 h-5 text-white/30 group-hover:text-primary transition-colors" />
              )}
            </button>

            {stickers.map((s) => (
              <button
                key={s.id}
                onClick={() => { onSelect(s.imageUrl); onClose(); }}
                className="aspect-square rounded-xl overflow-hidden hover:ring-2 hover:ring-primary transition-all active:scale-95"
              >
                <img
                  src={s.imageUrl}
                  alt={s.name ?? "sticker"}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}

            {stickers.length === 0 && !uploading && (
              <div className="col-span-3 flex items-center py-4 text-white/30 text-xs">
                Tap + to add from gallery
              </div>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
