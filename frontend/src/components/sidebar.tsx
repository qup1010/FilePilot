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
    { href: '/', icon: LayoutGrid, label: 'Workbench' },
    { href: '/history', icon: History, label: 'History' },
  ];

  // Map workspace routes back to / for activation logic
  const isNavActive = (href: string) => {
    if (href === '/') {
      return pathname === '/' || pathname.startsWith('/workspace');
    }
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-14 md:w-20 h-screen flex flex-col items-center py-6 border-r border-outline-variant/10 bg-surface-container-lowest z-40">
      <div className="mb-10 opacity-20">
        <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-white font-bold">
          W
        </div>
      </div>
      
      <nav className="flex flex-col gap-6 flex-1">
        {navItems.map((item) => {
          const isActive = isNavActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "p-3 rounded-xl transition-all duration-300 group relative flex justify-center items-center outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                isActive 
                  ? "text-primary bg-primary/10 shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)]" 
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
              )}
              title={item.label}
            >
              <item.icon className={cn("w-5 h-5 transition-transform duration-300", isActive ? "scale-110 fill-current/10" : "group-hover:scale-110")} />
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-primary rounded-r-full shadow-[0_0_10px_rgba(var(--primary-rgb),0.5)]" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-6 mt-auto">
        <button className="p-3 text-on-surface-variant hover:text-on-surface transition-all rounded-lg" title="Logs">
          <Terminal className="w-5 h-5" />
        </button>
      </div>
    </aside>
  );
}
