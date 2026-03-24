"use client";

import React, { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Settings, LayoutGrid, History, Terminal } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isSettings = pathname === '/settings';

  const navItems = [
    { href: '/', icon: LayoutGrid, label: '工作台' },
    { href: '/history', icon: History, label: '历史档案' },
  ];

  const isNavActive = (href: string) => {
    if (href === '/') {
      return pathname === '/' || pathname.startsWith('/workspace');
    }
    return pathname.startsWith(href);
  };

  return (
    <div className="bg-surface text-on-surface h-screen flex flex-col overflow-hidden font-sans">
      {/* Permanent Header */}
      <header className="flex justify-between items-center w-full px-8 py-3 border-b border-outline-variant/10 bg-white/65 backdrop-blur-3xl z-50 h-20 shrink-0">
        <div className="flex items-center gap-12">
          {/* Logo Section */}
          <Link href="/" className="flex items-center gap-4 hover:opacity-80 transition-opacity">
            <div className="w-10 h-10 rounded-2xl bg-on-surface text-white flex items-center justify-center font-black shadow-xl shadow-on-surface/10 text-xl italic select-none">
              W
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-black tracking-tight text-on-surface font-headline leading-tight">File Workbench</span>
              <span className="text-[10px] font-black text-on-surface-variant/30 uppercase tracking-[0.22em] leading-none">AI File Organizer</span>
            </div>
          </Link>

          {/* Center Navigation */}
          <nav className="hidden md:flex items-center gap-1.5 p-1 bg-surface-container-low/50 rounded-[20px] border border-on-surface/5">
            {navItems.map((item) => {
              const isActive = isNavActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-7 py-2.5 rounded-[16px] text-[13px] font-black transition-all flex items-center gap-2.5 tracking-tight uppercase",
                    isActive 
                      ? "bg-white text-on-surface shadow-sm border border-on-surface/5" 
                      : "text-on-surface-variant/30 hover:text-on-surface hover:bg-white/40"
                  )}
                >
                  <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-current")} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        
        {/* Right Utilities */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex flex-col items-end mr-6 pointer-events-none select-none">
            <span className="text-[11px] font-black text-on-surface/40 tracking-widest uppercase">面向目录整理</span>
            <span className="text-[11px] font-bold text-on-surface-variant/20 uppercase tracking-widest">v2.0.0 Alpha</span>
          </div>

          <div className="h-8 w-px bg-on-surface/5 mx-2" />

          <button 
            className="w-12 h-12 flex items-center justify-center rounded-2xl transition-all duration-300 outline-none border border-transparent text-on-surface-variant/30 hover:text-on-surface hover:bg-white hover:border-on-surface/5 hover:shadow-sm"
            title="查看执行日志"
          >
            <Terminal className="w-5 h-5" />
          </button>

          <Link 
            href={isSettings ? "/" : "/settings"}
            className={cn(
              "w-12 h-12 flex items-center justify-center rounded-2xl transition-all duration-300 outline-none border",
              isSettings 
                ? "text-primary bg-primary/10 border-primary/20 shadow-lg shadow-primary/10" 
                : "text-on-surface-variant/30 hover:text-on-surface hover:bg-white border-transparent hover:border-on-surface/5 hover:shadow-sm"
            )}
            title="系统设置"
          >
            <Settings className={cn("w-5 h-5 transition-transform duration-500", isSettings && "rotate-90")} />
          </Link>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {children}
      </main>
    </div>
  );
}
