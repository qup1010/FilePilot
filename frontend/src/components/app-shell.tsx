"use client";

import React, { ReactNode, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Settings, LayoutGrid, History, ChevronRight } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const LAST_WORKSPACE_HREF_KEY = "last_workspace_href";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function getModuleLabel(pathname: string) {
  if (pathname === "/history") {
    return { title: "历史记录", detail: "会话与执行档案" };
  }
  if (pathname === "/settings") {
    return { title: "设置", detail: "本地配置与偏好" };
  }
  if (pathname.startsWith("/workspace")) {
    return { title: "工作区", detail: "当前整理任务" };
  }
  return { title: "工作台", detail: "新建任务或继续会话" };
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

          <Link
            href={isSettings ? "/" : "/settings"}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-[9px] border transition-colors",
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
