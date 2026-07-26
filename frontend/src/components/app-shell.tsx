"use client";

import React, { ReactNode } from "react";
import { PageTransition } from "@/components/page-transition";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "motion/react";

// ... (existing imports)
import Link from "next/link";
import { BookOpenCheck, LayoutGrid, History, Settings, Palette, Sun, Moon, Monitor, CheckCircle2 } from "lucide-react";
import { WindowControls } from "./ui/window-controls";
import { GlobalTaskIndicator } from "./global-task-indicator";
import { useTheme } from "@/lib/theme";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getPathBasename } from "@/lib/path-normalization";
import { APP_CONTEXT_EVENT, WORKSPACE_CONTEXT_KEY, readActiveWorkspaceRoute } from "@/lib/app-context-store";

const SETTINGS_CONTEXT_KEY = "settings_header_context";
const HISTORY_CONTEXT_KEY = "history_header_context";
const ICONS_CONTEXT_KEY = "icons_header_context";

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
    return JSON.parse(raw) as {
      title?: string;
      detail?: string;
      dirName?: string;
      stage?: string;
      sessionId?: string;
      hasTargetPath?: boolean;
    };
  } catch {
    return null;
  }
}

function getWorkspaceLoadingLabel() {
  return {
    title: "当前任务",
    detail: "正在载入任务",
  };
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
      detail: "选择目标文件夹并生成图标",
    };
  }
  if (pathname.startsWith("/workspace")) {
    const dirParam = searchParams.get("dir");
    const sessionId = searchParams.get("session_id");
    if (sessionId && !dirParam) {
      return getWorkspaceLoadingLabel();
    }
    const dirName = getPathBasename(dirParam, "当前任务");
    return {
      title: dirName,
      detail: "当前整理任务",
    };
  }
  return { title: "开始整理", detail: "选择目录并开始新的整理任务" };
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
      detail: stored?.detail || "选择目标文件夹并生成图标",
    };
  }
  if (pathname.startsWith("/workspace")) {
    const stored = readStoredContext(WORKSPACE_CONTEXT_KEY);
    const dirParam = searchParams.get("dir");
    const sessionId = searchParams.get("session_id");
    if (dirParam) {
      const dirName = getPathBasename(dirParam, "当前任务");
      return {
        title: dirName,
        detail: stored?.stage || "当前整理任务",
      };
    }
    if (sessionId) {
      if (stored?.sessionId === sessionId && stored?.hasTargetPath && stored?.dirName) {
        return {
          title: stored.dirName,
          detail: stored.stage || "当前整理任务",
        };
      }
      return getWorkspaceLoadingLabel();
    }
    return {
      title: stored?.dirName || "当前任务",
      detail: stored?.stage || "当前整理任务",
    };
  }
  return { title: "开始整理", detail: "选择目录并开始新的整理任务" };
}

function getWorkspaceRoute(pathname: string, searchParams: URLSearchParams) {
  if (pathname.startsWith("/workspace")) {
    const rememberedParams = new URLSearchParams(searchParams);
    rememberedParams.delete("auto_scan");
    const query = rememberedParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }
  if (typeof window === "undefined") {
    return "/";
  }
  return readActiveWorkspaceRoute() || "/";
}

function ThemeToggle() {
  const { mode, setMode } = useTheme();
  // 主题模式来自 localStorage 懒初始化，SSR 首帧与客户端可能不同；挂载后再渲染具体状态避免水合不一致。
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const cycle = () => {
    const next = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
    setMode(next);
  };

  const Icon = !mounted ? Monitor : mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  const label = !mounted ? "主题" : mode === "light" ? "浅色" : mode === "dark" ? "深色" : "跟随系统";

  return (
    <button
      type="button"
      onClick={cycle}
      title={`当前：${label}，点击切换`}
      suppressHydrationWarning
      className="flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-[11px] font-bold text-on-surface-variant/60 transition-colors hover:bg-on-surface/5 hover:text-on-surface active:scale-95"
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden lg:inline" suppressHydrationWarning>{label}</span>
    </button>
  );
}

function ModuleStatusBadge({ detail }: { detail: string }) {
  const isSuccess = detail.includes("通过") || detail.toLowerCase().includes("success");

  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-[160px] shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[11px] font-black leading-none",
        isSuccess
          ? "bg-emerald-500/8 text-emerald-700 ring-1 ring-emerald-500/15 dark:text-emerald-300"
          : "bg-on-surface/[0.04] text-on-surface/45 ring-1 ring-on-surface/[0.05]",
      )}
      title={detail}
    >
      {isSuccess ? <CheckCircle2 className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />}
      <span className="truncate">{detail}</span>
    </span>
  );
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
    { href: workspaceRoute, icon: LayoutGrid, label: workspaceRoute === "/" ? "开始整理" : "当前任务" },
    { href: "/rules", icon: BookOpenCheck, label: "分类规则" },
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
      <div className="premium-bg" aria-hidden="true" />
      <header
        data-tauri-drag-region
        className="z-50 grid h-[48px] shrink-0 grid-cols-[minmax(180px,1fr)_auto_auto] items-center border-b border-on-surface/6 bg-surface-container-lowest px-2 backdrop-blur sm:grid-cols-[minmax(220px,1fr)_auto_minmax(118px,1fr)] sm:px-3 xl:grid-cols-[minmax(320px,1fr)_auto_minmax(180px,1fr)]"
      >
        <div data-tauri-drag-region className="flex min-w-0 items-center gap-3 pr-3 select-none">
          <div className="flex shrink-0 items-center gap-2.5">
            <img src="/app-icon.png" alt="FilePilot" className="h-5 w-5 object-contain active:scale-95 transition-transform" />
            <div className="flex items-baseline tracking-[-0.04em] pointer-events-none select-none">
              <span className="text-[14px] font-black text-on-surface">File</span>
              <span className="ml-0.5 text-[15px] font-black text-primary">Pilot</span>
              <span className="ml-0.5 h-1 w-1 rounded-full bg-primary" />
            </div>

            <div className="ml-1 h-4 w-px rounded-full bg-on-surface/12" />
          </div>

          <div className="flex min-w-0 items-center gap-2 overflow-hidden pointer-events-none">
            <p className="max-w-[180px] truncate text-[14px] font-black tracking-[-0.025em] text-on-surface/88 sm:max-w-[260px] xl:max-w-[360px]">
              {moduleCopy.title}
            </p>
            <ModuleStatusBadge detail={moduleCopy.detail} />
          </div>
        </div>

        <nav className="flex items-center justify-center rounded-[8px] bg-on-surface/[0.035] p-1 relative">
          {navItems.map((item) => {
            const isActive = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative inline-flex h-7.5 items-center gap-2 rounded-[8px] px-3 text-[12px] font-black tracking-tight transition-colors duration-200 z-10 select-none",
                  isActive
                    ? "text-primary font-black"
                    : "text-on-surface/40 hover:text-on-surface/80",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="app-shell-active-pill"
                    className="absolute inset-0 rounded-[8px] bg-surface-container-lowest shadow-[0_1px_3px_rgba(0,0,0,0.06)] -z-10"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <item.icon className={cn("h-3.5 w-3.5 transition-colors", isActive ? "text-primary" : "text-current")} />
                <span className="hidden lg:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div data-tauri-drag-region className="flex items-center justify-end gap-1 sm:gap-2">
          <div className="h-5 w-px rounded-full bg-on-surface/10" />
          <ThemeToggle />
          <WindowControls />
        </div>
      </header>
      <GlobalTaskIndicator />

      <main className="relative flex flex-1 flex-col overflow-hidden">
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
