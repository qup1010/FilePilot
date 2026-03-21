"use client";

import { useEffect, useState } from "react";

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
          ? "NEXT_PUBLIC_API_BASE_URL"
          : "fallback",
    );
  }, []);

  return (
    <section className="panel panel-accent">
      <div className="panel-title-row">
        <h2>系统连接状态</h2>
        <span className="pill">{source}</span>
      </div>
      <p className="mono">{baseUrl}</p>
      <p className="muted">
        正在监控本地或远程的后端 API 接口。
      </p>
    </section>
  );
}
