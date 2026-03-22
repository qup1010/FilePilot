"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, History, Terminal } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { href: '/', icon: LayoutGrid, label: '工作台' },
    { href: '/history', icon: History, label: '历史' },
  ];

  // Map workspace routes back to / for activation logic
  const isNavActive = (href: string) => {
    if (href === '/') {
      return pathname === '/' || pathname.startsWith('/workspace');
    }
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-14 md:w-[72px] h-screen flex flex-col items-center py-7 border-r border-outline-variant/10 bg-surface/70 backdrop-blur-sm z-40">
      <div className="mb-10 opacity-85">
        <div className="w-8 h-8 rounded-2xl bg-white text-primary border border-outline-variant/15 flex items-center justify-center font-bold shadow-sm">
          W
        </div>
      </div>
      
      <nav className="flex flex-col gap-4 flex-1">
        {navItems.map((item) => {
          const isActive = isNavActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "p-3 rounded-2xl transition-all duration-300 group relative flex justify-center items-center outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                isActive 
                  ? "text-primary bg-white shadow-sm border border-outline-variant/10" 
                  : "text-on-surface-variant/75 hover:text-on-surface hover:bg-white/60"
              )}
              title={item.label}
            >
              <item.icon className={cn("w-5 h-5 transition-transform duration-300", isActive ? "scale-105" : "group-hover:scale-105")} />
              {isActive && (
                <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-primary rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-6 mt-auto">
        <button className="p-3 text-on-surface-variant/70 hover:text-on-surface transition-all rounded-2xl hover:bg-white/60" title="日志">
          <Terminal className="w-5 h-5" />
        </button>
      </div>
    </aside>
  );
}
