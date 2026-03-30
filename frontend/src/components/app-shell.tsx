"use client";

import React, { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, History, ChevronRight, Settings, Palette } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const WORKSPACE_CONTEXT_KEY = "workspace_header_context";
const SETTINGS_CONTEXT_KEY = "settings_header_context";
const HISTORY_CONTEXT_KEY = "history_header_context";
const ICONS_CONTEXT_KEY = "icons_header_context";
const APP_CONTEXT_EVENT = "file-organizer-context-change";
const ACTIVE_WORKSPACE_ROUTE_KEY = "workspace_active_route";

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
      title: "整理历史",
      detail: "会话与执行档案",
    };
  }
  if (pathname === "/settings") {
    return {
      title: "设置",
      detail: "模型配置",
    };
  }
  if (pathname === "/icons") {
    return {
      title: "图标工坊",
      detail: "分析文件夹并生成 Windows 图标",
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
      title: "整理历史",
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
  if (pathname === "/icons") {
    const stored = readStoredContext(ICONS_CONTEXT_KEY);
    return {
      title: "图标工坊",
      detail: stored?.detail || "分析文件夹并生成 Windows 图标",
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

function getWorkspaceRoute(pathname: string, searchParams: URLSearchParams) {
  if (pathname.startsWith("/workspace")) {
    const query = searchParams.toString();
    return query ? `/workspace?${query}` : "/workspace";
  }
  if (typeof window === "undefined") {
    return "/";
  }
  return window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY) || "/";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isHydrated, setIsHydrated] = React.useState(false);
  const [moduleCopy, setModuleCopy] = React.useState(() => getBaseModuleLabel(pathname, searchParams));
  const [workspaceRoute, setWorkspaceRoute] = React.useState("/");

  React.useEffect(() => {
    setIsHydrated(true);
  }, []);

  React.useEffect(() => {
    setModuleCopy(getBaseModuleLabel(pathname, searchParams));
    setWorkspaceRoute(isHydrated ? getWorkspaceRoute(pathname, searchParams) : "/");
  }, [isHydrated, pathname, searchParams]);

  React.useEffect(() => {
    if (!isHydrated) {
      return;
    }
    setWorkspaceRoute(getWorkspaceRoute(pathname, searchParams));
  }, [pathname, searchParams]);

  React.useEffect(() => {
    const syncModuleCopy = () => {
      setModuleCopy(getStoredModuleLabel(pathname, searchParams));
      setWorkspaceRoute(getWorkspaceRoute(pathname, searchParams));
    };

    if (!isHydrated) {
      return;
    }

    syncModuleCopy();

    const handleContextChange = () => {
      syncModuleCopy();
    };

    window.addEventListener(APP_CONTEXT_EVENT, handleContextChange);
    return () => {
      window.removeEventListener(APP_CONTEXT_EVENT, handleContextChange);
    };
  }, [isHydrated, pathname, searchParams]);

  const navItems = [
    { href: workspaceRoute, icon: LayoutGrid, label: workspaceRoute === "/" ? "新建任务" : "当前任务" },
    { href: "/history", icon: History, label: "整理历史" },
    { href: "/icons", icon: Palette, label: "图标工坊" },
    { href: "/settings", icon: Settings, label: "设置" },
  ];

  const isNavActive = (href: string) => {
    if (href === "/" || href.startsWith("/workspace")) {
      return pathname === "/" || pathname.startsWith("/workspace");
    }
    return pathname.startsWith(href);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface text-on-surface font-sans">
      <header className="z-50 grid h-[60px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-on-surface/7 bg-surface-container-lowest/96 px-3 backdrop-blur sm:px-4">
        <div className="flex shrink-0 items-center gap-3 pr-3 lg:pr-5">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-transparent transition-all group-active:scale-95">
              <img
                src="/app-icon.png"
                alt="FilePilot"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="hidden min-w-0 md:block">
              <p className="truncate text-[15px] font-black tracking-tighter text-on-surface">FilePilot</p>
            </div>
          </Link>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3 border-none px-2 lg:px-4">
          <div className="flex min-w-0 items-center">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <p className="truncate text-[16px] font-black tracking-tight text-on-surface">{moduleCopy.title}</p>
                <ChevronRight className="h-3 w-3 shrink-0 text-on-surface/20" />
                <p className="truncate text-[12px] font-bold text-ui-muted/80">{moduleCopy.detail}</p>
              </div>
            </div>
          </div>
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
                    "inline-flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[12px] font-bold transition-all sm:px-3.5",
                    isActive ? "bg-surface text-on-surface shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]" : "text-ui-muted hover:text-on-surface",
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
