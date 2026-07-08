import React from 'react';
import { SignUp } from '@clerk/react';
import { basePath } from '@/lib/utils';

export default function SignUpPage() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center px-4 bg-background relative">
      {/* Background soft glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[300px] h-[300px] bg-secondary/10 blur-[100px] rounded-full" />
      </div>
      
      <div className="z-10 w-full max-w-[440px]">
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      </div>
    </div>
  );
}
