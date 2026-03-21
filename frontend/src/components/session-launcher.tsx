"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl } from "@/lib/runtime";

export function SessionLauncher() {
  const router = useRouter();
  const [targetDir, setTargetDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLaunch() {
    setLoading(true);
    setError(null);
    try {
      const api = createApiClient(getApiBaseUrl());
      const response = await api.createSession(targetDir, true);
      if (!response.session_id) {
        throw new Error("后端没有返回 session_id");
      }
      router.push(`/workspace?session_id=${response.session_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建会话失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectDir() {
    setLoading(true);
    setError(null);
    try {
      const api = createApiClient(getApiBaseUrl());
      const res = await api.selectDir();
      if (res.path) {
        setTargetDir(res.path);
      }
    } catch (err) {
      setError("无法调用文件夹选择器");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-title-row">
        <h2>启动整理会话</h2>
        <span className="pill">{loading ? "运行中" : "就绪"}</span>
      </div>
      <label className="field">
        <span>目标目录</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ flex: 1 }}
            value={targetDir}
            onChange={(event) => setTargetDir(event.target.value)}
            placeholder="D:/Downloads"
          />
          <button 
            type="button" 
            className="secondary-button" 
            onClick={handleSelectDir}
            disabled={loading}
          >
            📁 选择文件夹
          </button>
        </div>
      </label>
      <div className="hero-actions" style={{ marginTop: 24 }}>
        <button type="button" className="primary-button" onClick={handleLaunch} disabled={loading || !targetDir.trim()}>
          {loading ? "创建中..." : "创建 / 恢复会话"}
        </button>
      </div>
      {error ? <p className="error-text" style={{ marginTop: 12 }}>{error}</p> : null}
    </section>
  );
}
