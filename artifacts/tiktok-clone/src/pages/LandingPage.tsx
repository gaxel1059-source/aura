import React from 'react';
import { Show } from '@clerk/react';
import { Link, Redirect } from 'wouter';
import { Sparkles, Users, Palette, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { basePath } from '@/lib/utils';

export default function LandingPage() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/feed" />
      </Show>

      <Show when="signed-out">
        <div className="min-h-full flex flex-col bg-background relative overflow-hidden">
          {/* Subtle gradient orb in background */}
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[40%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[40%] bg-secondary/20 blur-[120px] rounded-full pointer-events-none" />

          <main className="flex-1 flex flex-col items-center px-6 pt-20 pb-12 z-10">
            {/* Header / Logo */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="flex flex-col items-center text-center mb-16"
            >
              <div className="w-16 h-16 mb-8 shadow-[0_0_40px_rgba(139,92,246,0.3)] rounded-full">
                <img src={`${basePath}/logo.svg`} alt="Aura Logo" className="w-full h-full" />
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-white mb-4">
                Content that <span className="aura-text-gradient">actually knows you.</span>
              </h1>
              <p className="text-muted-foreground text-lg max-w-sm">
                A social platform where your interests guide everything. Midnight vibes. Zero noise.
              </p>
            </motion.div>

            {/* CTAs */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
              className="w-full flex flex-col gap-4 max-w-sm mb-20"
            >
              <Link 
                href="/sign-up" 
                className="w-full h-12 flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold text-lg shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity"
              >
                Get started
                <ArrowRight className="w-5 h-5" />
              </Link>
              <Link 
                href="/sign-in" 
                className="w-full h-12 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white font-medium hover:bg-white/10 transition-colors"
              >
                Sign in
              </Link>
            </motion.div>

            {/* Features */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
              className="w-full max-w-sm flex flex-col gap-4"
            >
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 backdrop-blur-sm">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm mb-1">Smart feed</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">No generic algorithms. Curated specifically for your niche interests.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 backdrop-blur-sm">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm mb-1">Real creators</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">Connect with artists, thinkers, and makers who care about craft.</p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 backdrop-blur-sm">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Palette className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm mb-1">Your Aura</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">Premium dark mode experience designed to let content breathe.</p>
                </div>
              </div>
            </motion.div>
          </main>
        </div>
      </Show>
    </>
  );
}
