"use client";

import React, { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, History, ChevronRight, Settings } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const WORKSPACE_CONTEXT_KEY = "workspace_header_context";
const SETTINGS_CONTEXT_KEY = "settings_header_context";
const HISTORY_CONTEXT_KEY = "history_header_context";
const APP_CONTEXT_EVENT = "file-organizer-context-change";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function readStoredContext(key: string) {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as { title?: string; detail?: string; dirName?: string; stage?: string };
  } catch {
    return null;
  }
}

function getBaseModuleLabel(pathname: string, searchParams: URLSearchParams) {
  if (pathname === "/history") {
    return {
      title: "历史",
      detail: "会话与执行档案",
    };
  }
  if (pathname === "/settings") {
    return {
      title: "设置",
      detail: "模型配置",
    };
  }
  if (pathname.startsWith("/workspace")) {
    const dirParam = searchParams.get("dir");
    const dirName = dirParam
      ? decodeURIComponent(dirParam).replace(/[\\/]$/, "").split(/[\\/]/).pop() || "当前任务"
      : "当前任务";
    return {
      title: dirName,
      detail: "当前整理任务",
    };
  }
  return { title: "新建任务", detail: "选择目录并启动新的整理任务" };
}

function getStoredModuleLabel(pathname: string, searchParams: URLSearchParams) {
  if (pathname === "/history") {
    const stored = readStoredContext(HISTORY_CONTEXT_KEY);
    return {
      title: "历史",
      detail: stored?.detail || "会话与执行档案",
    };
  }
  if (pathname === "/settings") {
    const stored = readStoredContext(SETTINGS_CONTEXT_KEY);
    return {
      title: "设置",
      detail: stored?.detail || "模型配置",
    };
  }
  if (pathname.startsWith("/workspace")) {
    const stored = readStoredContext(WORKSPACE_CONTEXT_KEY);
    const dirParam = searchParams.get("dir");
    const dirName = dirParam ? decodeURIComponent(dirParam).replace(/[\\/]$/, "").split(/[\\/]/).pop() || "当前任务" : stored?.dirName || "当前任务";
    return {
      title: dirName,
      detail: stored?.stage || "当前整理任务",
    };
  }
  return { title: "新建任务", detail: "选择目录并启动新的整理任务" };
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [moduleCopy, setModuleCopy] = React.useState(() => getBaseModuleLabel(pathname, searchParams));

  React.useEffect(() => {
    setModuleCopy(getBaseModuleLabel(pathname, searchParams));
  }, [pathname, searchParams]);

  React.useEffect(() => {
    const syncModuleCopy = () => {
      setModuleCopy(getStoredModuleLabel(pathname, searchParams));
    };

    syncModuleCopy();

    const handleContextChange = () => {
      syncModuleCopy();
    };

    window.addEventListener(APP_CONTEXT_EVENT, handleContextChange);
    return () => {
      window.removeEventListener(APP_CONTEXT_EVENT, handleContextChange);
    };
  }, [pathname, searchParams]);

  const navItems = [
    { href: "/", icon: LayoutGrid, label: "新建任务" },
    { href: "/history", icon: History, label: "历史" },
    { href: "/settings", icon: Settings, label: "设置" },
  ];

  const isNavActive = (href: string) => {
    if (href === "/") {
      return pathname === "/" || pathname.startsWith("/workspace");
    }
    return pathname.startsWith(href);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface text-on-surface font-sans">
      <header className="z-50 grid h-[54px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-on-surface/8 bg-surface-container-lowest px-2 sm:px-4">
        <div className="flex shrink-0 items-center gap-2 border-r border-on-surface/6 pr-3 lg:pr-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-on-surface/8 bg-surface-container text-[0.92rem] font-black text-on-surface transition-transform active:scale-95">
              F
            </div>
            <p className="hidden md:block truncate text-[14px] font-black tracking-tight text-on-surface">File Organizer</p>
          </Link>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 px-3 lg:gap-2.5">
          <p className="truncate text-[13px] font-bold text-on-surface sm:text-[14px]">{moduleCopy.title}</p>
          <ChevronRight className="hidden sm:block h-3.5 w-3.5 text-on-surface/25" />
          <p className="hidden truncate text-[12px] text-ui-muted sm:block">{moduleCopy.detail}</p>
        </div>

        <div className="flex items-center justify-end gap-1.5 sm:gap-2">
          <nav className="flex items-center rounded-[10px] border border-on-surface/6 bg-surface-container p-0.5 sm:p-1">
            {navItems.map((item) => {
              const isActive = isNavActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[12px] font-bold transition-all sm:px-3",
                    isActive ? "bg-white text-on-surface shadow-sm" : "text-ui-muted hover:text-on-surface",
                  )}
                >
                  <item.icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-current")} />
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
