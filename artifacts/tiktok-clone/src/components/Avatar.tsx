import React from 'react';
import { basePath } from '@/lib/utils';

interface AvatarProps {
  src?: string | null;
  fallback?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

/**
 * Resolve an avatar src that may be:
 *  - A full URL (http/https) or a blob/data URI → use as-is
 *  - A raw storage object path (e.g. "images/abc.jpg" or "/objects/images/abc.jpg")
 *    → prefix with the storage API URL
 */
function resolveAvatarSrc(src?: string | null): string | undefined {
  if (!src) return undefined;
  if (src.startsWith('http') || src.startsWith('blob:') || src.startsWith('data:')) return src;
  const clean = src.replace(/^\/objects\//, '');
  return `${basePath}/api/storage/objects/${clean}`;
}

export function Avatar({ src, fallback, size = 'md', className = '' }: AvatarProps) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-16 h-16 text-lg',
    xl: 'w-24 h-24 text-2xl',
  };

  const fallbackText = (fallback || 'User').slice(0, 2).toUpperCase();
  const resolvedSrc = resolveAvatarSrc(src);

  return (
    <div className={`relative rounded-full overflow-hidden flex items-center justify-center bg-white/5 border border-white/10 ${sizeClasses[size]} ${className}`}>
      {resolvedSrc ? (
        <img src={resolvedSrc} alt={fallback || 'Avatar'} className="w-full h-full object-cover" />
      ) : (
        <span className="text-white/70 font-medium">{fallbackText}</span>
      )}
    </div>
  );
}
