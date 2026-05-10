"use client";

import React, { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function WindowControls() {
  const [isTauri, setIsTauri] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // We can only use @tauri-apps/api in a Tauri environment
    const checkEnvironment = () => {
       const win = (window as any);
       if (win.__TAURI_INTERNALS__ || win.__TAURI__) {
          setIsTauri(true);
       }
    };
    checkEnvironment();

    // Listen to maximize events if possible
    // For now we'll just handle the basics
  }, []);

  if (!isTauri) return null;

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.toggleMaximize();
    setIsMaximized(await win.isMaximized());
  };

  const handleClose = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  };

  return (
    <div className="flex items-center h-full ml-2 border-l border-on-surface/5 pl-2">
      <button
        onClick={handleMinimize}
        className="flex h-8 w-10 items-center justify-center text-ui-muted hover:bg-on-surface/5 transition-colors"
        title="最小化"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={handleMaximize}
        className="flex h-8 w-10 items-center justify-center text-ui-muted hover:bg-on-surface/5 transition-colors"
        title={isMaximized ? "向下还原" : "最大化"}
      >
        {isMaximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
      </button>
      <button
        onClick={handleClose}
        className="flex h-8 w-10 items-center justify-center text-ui-muted hover:bg-error/10 hover:text-error transition-colors"
        title="关闭"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
