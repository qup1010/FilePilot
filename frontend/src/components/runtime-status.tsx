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
      typeof window !== "undefined" && window.__FILE_PILOT_RUNTIME__
        ? "桌面应用注入"
        : process.env.NEXT_PUBLIC_API_BASE_URL
          ? "环境变量"
          : "默认地址",
    );
  }, []);

  return (
    <details className="group rounded-[8px] border border-on-surface/8 bg-surface-container-lowest">
      <summary className="flex list-none cursor-pointer items-center justify-between gap-3 px-4 py-3 select-none">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-on-surface/8 bg-surface-container text-primary">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-[14px] font-semibold text-on-surface">
              <span className="h-2 w-2 rounded-full bg-success" />
              本地服务已连接
            </div>
            <p className="text-[12px] text-ui-muted">{baseUrl}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-ui-muted transition-transform group-open:rotate-90" />
      </summary>
      <div className="border-t border-on-surface/6 px-4 py-3">
        <div className="flex items-center justify-between border-b border-on-surface/6 pb-2">
          <span className="flex items-center gap-2 text-[13px] font-medium text-on-surface">
            <Terminal className="h-3.5 w-3.5 text-primary" />
            当前连接信息
          </span>
          <span className="text-ui-meta text-ui-muted">v1.0</span>
        </div>
        <div className="mt-3 grid gap-2 font-mono text-[12px] text-on-surface-variant">
          <div className="grid gap-1 rounded-[8px] border border-on-surface/8 bg-surface-container-low px-3 py-2">
            <span>服务地址</span>
            <span className="break-all text-on-surface">{baseUrl}</span>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-[8px] border border-on-surface/8 bg-surface-container-low px-3 py-2">
            <span>来源</span>
            <span className="text-primary">{source}</span>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-[8px] border border-on-surface/8 bg-surface-container-low px-3 py-2">
            <span>环境</span>
            <span>{process.env.NODE_ENV || "development"}</span>
          </div>
        </div>
      </div>
    </details>
  );
}
