import React from 'react';
import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-background px-6 text-center">
      <div className="w-24 h-24 mb-8 bg-white/5 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.05)] text-primary font-bold text-4xl">
        404
      </div>
      <h1 className="text-3xl font-bold text-white mb-4">Signal Lost</h1>
      <p className="text-muted-foreground text-base max-w-xs mb-8">
        The page you're looking for has drifted into the void.
      </p>
      <Link 
        href="/" 
        className="flex items-center gap-2 px-6 py-3 rounded-full bg-white/10 text-white font-medium hover:bg-white/20 transition-colors border border-white/10"
      >
        <ArrowLeft className="w-4 h-4" />
        Return to safety
      </Link>
    </div>
  );
}
