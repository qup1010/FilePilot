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
    <details className="group mt-4">
      <summary className="list-none cursor-pointer flex justify-center items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/40 hover:text-primary transition-colors select-none select-none">
        <Server className="w-3.5 h-3.5" />
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          系统引擎已连接
        </span>
        <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform ml-1" />
      </summary>
      <div className="mt-4 bg-surface-container-highest/50 border border-outline-variant/10 rounded-xl p-4 flex flex-col gap-2 font-mono text-[10px] text-on-surface-variant">
        <div className="flex justify-between items-center pb-2 border-b border-outline-variant/5">
           <span className="uppercase tracking-widest font-sans font-bold flex items-center gap-2"><Terminal className="w-3 h-3"/> Debug Context</span>
           <span className="text-on-surface-variant/50">v1.0</span>
        </div>
        <div className="flex justify-between pt-1">
          <span>Engine URL:</span>
          <span className="text-on-surface">{baseUrl}</span>
        </div>
        <div className="flex justify-between">
          <span>Resolution Source:</span>
          <span className="text-primary">{source}</span>
        </div>
        <div className="flex justify-between">
          <span>Environment:</span>
          <span>{process.env.NODE_ENV || 'development'}</span>
        </div>
      </div>
    </details>
  );
}
