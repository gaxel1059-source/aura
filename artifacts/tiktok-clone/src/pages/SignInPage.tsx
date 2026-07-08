import React from 'react';
import { SignIn } from '@clerk/react';
import { basePath } from '@/lib/utils';

export default function SignInPage() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center px-4 bg-background relative">
      {/* Background soft glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[300px] h-[300px] bg-primary/10 blur-[100px] rounded-full" />
      </div>
      
      <div className="z-10 w-full max-w-[440px]">
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </div>
  );
}
