"use client";

import React, { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { Sidebar } from './sidebar';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isSettings = pathname === '/settings';

  let currentViewLabel = 'WORKBENCH';
  if (isSettings) currentViewLabel = 'SETTINGS';
  else if (pathname.startsWith('/history')) currentViewLabel = 'HISTORY';
  else if (pathname.startsWith('/workspace')) currentViewLabel = 'SESSION'; // Could be dynamic based on dir

  return (
    <div className="bg-surface text-on-surface h-screen flex flex-col overflow-hidden font-sans">
      {/* Header */}
      <header className="flex justify-between items-center w-full px-6 py-3 border-b border-outline-variant/10 bg-surface-container-lowest z-50">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight text-on-surface font-headline">File Workbench</span>
          <div className="h-4 w-[1px] bg-outline-variant/30"></div>
          <span className="text-[0.65rem] font-bold text-on-surface-variant font-sans tracking-widest uppercase opacity-70">
            {currentViewLabel}
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          <Link 
            href={isSettings ? "/" : "/settings"}
            className={cn(
              "p-2 rounded-lg transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              isSettings 
                ? "text-primary bg-primary/10" 
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
            )}
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </Link>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <Sidebar />
        
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {children}
        </div>
      </main>
    </div>
  );
}
