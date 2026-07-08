import React from 'react';
import { useAuth } from '@clerk/react';
import { Redirect } from 'wouter';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <div className="min-h-[100dvh] flex items-center justify-center bg-background" />;
  }

  if (!isSignedIn) {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}
