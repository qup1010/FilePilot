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

  let currentViewLabel = '工作台';
  if (isSettings) currentViewLabel = '设置';
  else if (pathname.startsWith('/history')) currentViewLabel = '历史';
  else if (pathname.startsWith('/workspace')) currentViewLabel = '会话';

  return (
    <div className="bg-surface text-on-surface h-screen flex flex-col overflow-hidden font-sans">
      {/* Header */}
      <header className="flex justify-between items-center w-full px-7 py-4 border-b border-outline-variant/10 bg-surface/90 backdrop-blur-sm z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold tracking-tight text-on-surface font-headline">File Workbench</span>
            <div className="h-4 w-[1px] bg-outline-variant/30"></div>
            <span className="text-xs font-medium text-on-surface-variant/80">
              {currentViewLabel}
            </span>
          </div>
          <span className="hidden lg:block text-sm text-on-surface-variant/65">
            面向目录整理的安静工作台
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          <Link 
            href={isSettings ? "/" : "/settings"}
            className={cn(
              "p-2.5 rounded-full transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              isSettings 
                ? "text-primary bg-primary/10" 
                : "text-on-surface-variant hover:text-on-surface hover:bg-white/65"
            )}
            title="设置"
          >
            <Settings className="w-4.5 h-4.5" />
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
