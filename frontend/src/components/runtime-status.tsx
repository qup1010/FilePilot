"use client";

import { useEffect, useState } from "react";
import { Server, Activity, ChevronRight, Terminal } from "lucide-react";
import { getApiBaseUrl, readRuntimeConfig } from "@/lib/runtime";

export function RuntimeStatus() {
  const [baseUrl, setBaseUrl] = useState(getApiBaseUrl());
  const [source, setSource] = useState<string>("fallback");

  useEffect(() => {
    const config = readRuntimeConfig();
    setBaseUrl(config.base_url?.trim() || getApiBaseUrl());
    setSource(
      typeof window !== "undefined" && window.__FILE_ORGANIZER_RUNTIME__
        ? "tauri runtime"
        : process.env.NEXT_PUBLIC_API_BASE_URL
          ? "NEXT_PUBLIC_ENV"
          : "fallback",
    );
  }, []);

  return (
    <details className="group mt-2">
      <summary className="list-none cursor-pointer flex justify-center items-center gap-2 text-xs font-medium text-on-surface-variant/70 hover:text-primary transition-colors select-none">
        <Server className="w-3.5 h-3.5" />
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          系统引擎已连接
        </span>
        <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform ml-1" />
      </summary>
      <div className="mt-4 bg-white/60 border border-outline-variant/10 rounded-2xl p-4 flex flex-col gap-2 font-mono text-xs text-on-surface-variant">
        <div className="flex justify-between items-center pb-2 border-b border-outline-variant/5">
           <span className="font-sans font-medium flex items-center gap-2"><Terminal className="w-3 h-3"/> 运行时上下文</span>
           <span className="text-on-surface-variant/50">v1.0</span>
        </div>
        <div className="flex justify-between pt-1">
          <span>引擎地址:</span>
          <span className="text-on-surface">{baseUrl}</span>
        </div>
        <div className="flex justify-between">
          <span>来源:</span>
          <span className="text-primary">{source}</span>
        </div>
        <div className="flex justify-between">
          <span>环境:</span>
          <span>{process.env.NODE_ENV || 'development'}</span>
        </div>
      </div>
    </details>
  );
}
