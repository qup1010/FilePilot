"use client";

import { useEffect, useRef, useState } from "react";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl } from "@/lib/runtime";
import { createSessionEventStream, type SessionEventStream } from "@/lib/sse";
import type { JournalSummary, SessionSnapshot } from "@/types/session";

export function useSession(sessionId: string | null) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [journal, setJournal] = useState<JournalSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [aiTyping, setAiTyping] = useState("");
  const [actionLog, setActionLog] = useState<{ id: string; time: string; message: string; important: boolean }[]>([]);
  const streamRef = useRef<SessionEventStream | null>(null);
  const api = createApiClient(getApiBaseUrl());

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setActiveAction(null);
    setAiTyping("");

    api.getSession(sessionId)
      .then((nextSnapshot) => {
        if (!cancelled) {
          setSnapshot(nextSnapshot);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    streamRef.current?.close();
    streamRef.current = createSessionEventStream({
      baseUrl: getApiBaseUrl(),
      sessionId,
      onEvent: (event) => {
        if (event.event_type === "scan.action" || event.event_type === "plan.action") {
          const action = (event as any).action;
          let message = "";
          if (action?.name === "read_local_file") {
            message = `读取文件: ${action.args?.filename || "..."}`;
          } else if (action?.name === "list_local_files") {
            message = `检索目录: ${action.args?.directory || "."}`;
          } else if (action?.message) {
            message = action.message;
          }

          if (message) {
            setActiveAction(message);
            setActionLog(prev => [
              ...prev, 
              { 
                id: Math.random().toString(36).slice(2), 
                time: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }), 
                message, 
                important: !!action?.name
              }
            ].slice(-50)); // 只保留最近50条
          }
        } else if (event.event_type === "plan.ai_typing") {
          setAiTyping(prev => prev + ((event as any).content || ""));
        } else {
          setSnapshot(event.session_snapshot);
          // 快照更新不代表 AI 停止思考，可能只是中间状态更新
          if (event.event_type === "plan.updated") {
             setActiveAction(null);
          }
        }
      },
      onError: () => {
        setError("事件流已断开，请刷新当前会话。");
      },
    });

    return () => {
      cancelled = true;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [sessionId]);

  async function refreshSnapshot() {
    if (!sessionId) {
      return;
    }
    setSnapshot(await api.getSession(sessionId));
  }

  async function sendMessage(content: string) {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.sendMessage(sessionId, content);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送消息失败");
    } finally {
      setLoading(false);
    }
  }

  async function scan() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.scanSession(sessionId);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动扫描失败");
    } finally {
      setLoading(false);
    }
  }

  async function refreshPlan() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.refreshSession(sessionId);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新扫描失败");
    } finally {
      setLoading(false);
    }
  }

  async function runPrecheck() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.runPrecheck(sessionId);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "预检失败");
    } finally {
      setLoading(false);
    }
  }

  async function execute() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.execute(sessionId, true);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "执行失败");
    } finally {
      setLoading(false);
    }
  }

  async function rollback() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.rollback(sessionId, true);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "回退失败");
    } finally {
      setLoading(false);
    }
  }

  async function cleanupEmptyDirs() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.cleanupEmptyDirs(sessionId);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "清理空目录失败");
    } finally {
      setLoading(false);
    }
  }

  async function abandonSession() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    try {
      await api.abandonSession(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "放弃会话失败");
    } finally {
      setLoading(false);
    }
  }

  async function openExplorer(path: string) {
    try {
      await api.post("/api/utils/open-dir", { path });
    } catch (err) {
      setError("无法打开文件夹: 路径不存在或系统错误");
    }
  }

  async function loadJournal() {
    if (!sessionId) {
      return;
    }
    try {
      setJournal(await api.getJournal(sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取 journal 失败");
    }
  }

  return {
    snapshot,
    journal,
    loading,
    error,
    refreshSnapshot,
    sendMessage,
    scan,
    refreshPlan,
    runPrecheck,
    execute,
    rollback,
    cleanupEmptyDirs,
    abandonSession,
    openExplorer,
    loadJournal,
    activeAction,
    aiTyping,
    actionLog,
  };
}
