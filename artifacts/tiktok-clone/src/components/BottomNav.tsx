import React, { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { Home, Compass, Plus, MessageCircle, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUser } from '@clerk/react';
import { basePath } from '@/lib/utils';

export function BottomNav() {
  const [location] = useLocation();
  const { isSignedIn } = useUser();

  // Poll unread message count every 15s
  const [unreadMessages, setUnreadMessages] = React.useState(0);

  useEffect(() => {
    if (!isSignedIn) return;

    function fetchUnread() {
      fetch(`${basePath}/api/conversations/unread-count`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => setUnreadMessages(d.count ?? 0))
        .catch(() => {});
    }

    fetchUnread();
    const id = setInterval(fetchUnread, 15000);
    return () => clearInterval(id);
  }, [isSignedIn]);

  const navItems = [
    { icon: Home, path: '/feed', label: 'Home' },
    { icon: Compass, path: '/explore', label: 'Explore' },
    { icon: Plus, path: '/upload', label: 'Upload', isCenter: true },
    { icon: MessageCircle, path: '/messages', label: 'Messages', hasBadge: unreadMessages > 0, badgeCount: unreadMessages },
    { icon: User, path: '/profile', label: 'Profile' },
  ];

  return (
    <div className="absolute bottom-0 w-full bg-black/80 backdrop-blur-xl border-t border-white/5 pb-safe pt-2 px-4 z-50">
      <div className="flex justify-between items-center pb-2">
        {navItems.map((item, i) => {
          const isActive = location === item.path || location.startsWith(item.path + '/');

          if (item.isCenter) {
            return (
              <Link href={item.path} key={i} className="flex flex-col items-center justify-center pt-1 px-2 cursor-pointer">
                <div className="h-9 w-12 bg-white text-black rounded-xl flex items-center justify-center aura-gradient shadow-lg shadow-primary/20 hover:scale-105 transition-transform">
                  <Plus className="h-6 w-6 text-white" strokeWidth={2.5} />
                </div>
              </Link>
            );
          }

          return (
            <Link
              key={i}
              href={item.path}
              className="flex flex-col items-center justify-center p-2 min-w-[3.5rem] cursor-pointer relative"
            >
              <div className="relative">
                <item.icon
                  className={cn(
                    "h-6 w-6 mb-1 transition-colors",
                    isActive ? "text-primary" : "text-white/50",
                  )}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {item.hasBadge && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-rose-500 rounded-full flex items-center justify-center text-[9px] font-bold text-white px-0.5 leading-none">
                    {(item.badgeCount ?? 0) > 99 ? '99+' : item.badgeCount}
                  </span>
                )}
              </div>
              <span className={cn(
                "text-[10px] font-medium transition-colors",
                isActive ? "text-primary" : "text-white/50",
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
