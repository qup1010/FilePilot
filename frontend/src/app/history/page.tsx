"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "@/components/app-frame";
import { createApiClient } from "@/lib/api";
import { getApiBaseUrl } from "@/lib/runtime";

interface HistoryEntry {
  execution_id: string;
  target_dir: string;
  status: string;
  created_at: string;
  item_count: number;
}

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadHistory() {
    setLoading(true);
    try {
      const api = createApiClient(getApiBaseUrl());
      // Expecting /api/history returns list of HistoryEntry
      const response = await fetch(`${getApiBaseUrl()}/api/history`);
      if (!response.ok) throw new Error("无法获取历史记录");
      const data = await response.json();
      setHistory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  return (
    <AppFrame title="历史记录" subtitle="查看过去的整理操作及其执行状态。">
      <section className="panel">
        <div className="panel-title-row">
          <h2>执行记录</h2>
          <button className="secondary-button" onClick={() => void loadHistory()} disabled={loading}>
            刷新
          </button>
        </div>

        {loading ? (
          <p className="muted">正在加载历史记录...</p>
        ) : error ? (
          <p className="error-text">{error}</p>
        ) : history.length === 0 ? (
          <p className="muted">暂无任何执行记录。</p>
        ) : (
          <div className="history-list">
            {history.map((entry) => (
              <div key={entry.execution_id} className="history-card">
                <div className="history-header">
                  <strong>{entry.target_dir}</strong>
                  <span className={`pill status-${entry.status.toLowerCase()}`}>
                    {entry.status === "completed" ? "已完成" : entry.status === "rolled_back" ? "已回退" : entry.status}
                  </span>
                </div>
                <div className="history-details">
                  <span className="muted">时间: {new Date(entry.created_at).toLocaleString()}</span>
                  <span className="muted">文件数: {entry.item_count}</span>
                  <span className="muted">ID: {entry.execution_id.slice(0, 8)}</span>
                </div>
                <div className="history-actions">
                    <a href={`/workspace?session_id=${entry.execution_id}`} className="text-button">
                      查看详情与回退
                    </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <style jsx>{`
        .history-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 16px;
        }
        .history-card {
          padding: 16px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
        }
        .history-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .history-details {
          display: flex;
          gap: 16px;
          font-size: 0.85rem;
          margin-bottom: 12px;
        }
        .history-actions {
          display: flex;
          justify-content: flex-end;
        }
        .status-completed { color: #4ade80; }
        .status-rolled_back { color: #94a3b8; }
        .text-button {
          font-size: 0.85rem;
          color: #60a5fa;
          text-decoration: none;
        }
        .text-button:hover {
          text-decoration: underline;
        }
      `}</style>
    </AppFrame>
  );
}
