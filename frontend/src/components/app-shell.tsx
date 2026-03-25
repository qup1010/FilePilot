"use client";

import React, { ReactNode, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Settings, LayoutGrid, History, Terminal, ChevronRight } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const LAST_WORKSPACE_HREF_KEY = "last_workspace_href";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function getModuleLabel(pathname: string) {
  if (pathname === "/history") {
    return { title: "历史记录", detail: "查看会话、执行结果与回退记录" };
  }
  if (pathname === "/settings") {
    return { title: "设置", detail: "管理本地 API、运行环境与偏好" };
  }
  if (pathname.startsWith("/workspace")) {
    return { title: "工作区", detail: "继续当前整理任务" };
  }
  return { title: "工作台", detail: "新建整理任务或继续上次会话" };
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isSettings = pathname === "/settings";
  const [lastWorkspaceHref, setLastWorkspaceHref] = useState("/");

  const currentWorkbenchHref = useMemo(() => {
    if (pathname === "/") {
      return "/";
    }
    if (!pathname.startsWith("/workspace")) {
      return null;
    }
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedHref = window.localStorage.getItem(LAST_WORKSPACE_HREF_KEY);
    if (savedHref) {
      setLastWorkspaceHref(savedHref);
    }
  }, []);

  useEffect(() => {
    if (!currentWorkbenchHref || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(LAST_WORKSPACE_HREF_KEY, currentWorkbenchHref);
    setLastWorkspaceHref(currentWorkbenchHref);
  }, [currentWorkbenchHref]);

  const workbenchHref = currentWorkbenchHref || lastWorkspaceHref || "/";
  const moduleCopy = getModuleLabel(pathname);

  const navItems = [
    { href: workbenchHref, icon: LayoutGrid, label: "工作台" },
    { href: "/history", icon: History, label: "历史" },
  ];

  const isNavActive = (href: string) => {
    if (href === "/") {
      return pathname === "/" || pathname.startsWith("/workspace");
    }
    return pathname.startsWith(href);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface text-on-surface font-sans">
      <header className="z-50 grid h-[62px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-on-surface/8 bg-surface-container-lowest px-3 sm:px-4 lg:grid-cols-[260px_minmax(0,1fr)_auto] lg:px-5">
        <div className="flex min-w-0 items-center gap-3 border-r border-on-surface/6 pr-3 lg:pr-4">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-on-surface/8 bg-surface-container text-[0.95rem] font-black text-on-surface">
              F
            </div>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-black tracking-tight text-on-surface">File Organizer</p>
              <p className="truncate text-ui-meta text-ui-muted">Desktop Workbench</p>
            </div>
          </Link>
        </div>

        <div className="hidden min-w-0 items-center gap-3 px-4 lg:flex">
          <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-ui-muted">
            <span>当前模块</span>
            <ChevronRight className="h-3.5 w-3.5 text-on-surface/30" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-on-surface">{moduleCopy.title}</p>
            <p className="truncate text-ui-meta text-ui-muted">{moduleCopy.detail}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-1.5 sm:gap-2">
          <nav className="flex items-center rounded-[10px] border border-on-surface/6 bg-surface-container px-1 py-1">
            {navItems.map((item) => {
              const isActive = isNavActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-[12px] font-semibold transition-colors sm:px-3",
                    isActive ? "bg-white text-on-surface" : "text-ui-muted hover:text-on-surface",
                  )}
                >
                  <item.icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-current")} />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            className="hidden h-9 w-9 items-center justify-center rounded-[10px] border border-transparent text-ui-muted transition-colors hover:border-on-surface/8 hover:bg-white hover:text-on-surface lg:inline-flex"
            title="查看执行日志"
          >
            <Terminal className="h-[18px] w-[18px]" />
          </button>

          <Link
            href={isSettings ? "/" : "/settings"}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-[10px] border transition-colors",
              isSettings
                ? "border-primary/20 bg-primary/10 text-primary"
                : "border-transparent text-ui-muted hover:border-on-surface/8 hover:bg-white hover:text-on-surface",
            )}
            title="系统设置"
          >
            <Settings className="h-[18px] w-[18px]" />
          </Link>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
