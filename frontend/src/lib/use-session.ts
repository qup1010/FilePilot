"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl } from "@/lib/runtime";
import { createSessionEventStream, type SessionEventStream } from "@/lib/sse";
import type {
  ActivityFeedEntry,
  ComposerMode,
  JournalSummary,
  SessionEvent,
  SessionSnapshot,
  SessionStage,
} from "@/types/session";

function createLocalMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowLabel(): string {
  return new Date().toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function actionMessageFromEvent(event: SessionEvent): { phase: ActivityFeedEntry["phase"]; message: string; important: boolean } | null {
  const action = event.action as any;
  if (!action) {
    return null;
  }

  let message = "";
  if (action?.name === "read_local_file") {
    message = `读取文件: ${action.args?.filename || "..."}`;
  } else if (action?.name === "list_local_files") {
    message = `检索目录: ${action.args?.directory || "."}`;
  } else if (action?.message) {
    message = action.message;
  }

  if (!message) {
    return null;
  }

  return {
    phase: event.event_type.startsWith("scan.") ? "scan" : "plan",
    message,
    important: !!action?.name,
  };
}

function composerModeForStage(stage: SessionStage): ComposerMode {
  if (stage === "planning" || stage === "ready_for_precheck") {
    return "editable";
  }
  if (stage === "scanning") {
    return "readonly";
  }
  return "hidden";
}

export function useSession(sessionId: string | null) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [journal, setJournal] = useState<JournalSummary | null>(null);
  const [journalLoading, setJournalLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [activityFeed, setActivityFeed] = useState<ActivityFeedEntry[]>([]);
  const streamRef = useRef<SessionEventStream | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const api = createApiClient(getApiBaseUrl());

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  function resetConversationTransientState() {
    setAssistantDraft("");
    setActivityFeed([]);
    setChatError(null);
  }

  function appendActivity(entry: Omit<ActivityFeedEntry, "id" | "time">) {
    setActivityFeed((prev) => [
      ...prev,
      {
        id: createLocalMessageId(`activity-${entry.phase}`),
        time: nowLabel(),
        ...entry,
      },
    ].slice(-80));
  }

  function appendStreamingActivity(phase: ActivityFeedEntry["phase"], content: string) {
    if (!content) {
      return;
    }
    setActivityFeed((prev) => {
      const last = prev.at(-1);
      if (last && last.id.startsWith(`stream-${phase}`)) {
        return [
          ...prev.slice(0, -1),
          {
            ...last,
            message: `${last.message}${content}`,
          },
        ];
      }
      return [
        ...prev,
        {
          id: `stream-${phase}-${createLocalMessageId("chunk")}`,
          phase,
          time: nowLabel(),
          message: content,
          important: false,
        },
      ].slice(-80);
    });
  }

  useEffect(() => {
    if (!sessionId) {
      setSnapshot(null);
      setJournal(null);
      setJournalLoading(false);
      setLoading(false);
      resetConversationTransientState();
      return;
    }

    let cancelled = false;
    setLoading(true);
    setJournal(null);
    setJournalLoading(false);
    resetConversationTransientState();

    api.getSession(sessionId)
      .then((response) => {
        if (!cancelled && response.session_snapshot) {
          setSnapshot(response.session_snapshot);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setChatError(err.message);
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
          const entry = actionMessageFromEvent(event);
          if (entry) {
            appendActivity(entry);
          }
          return;
        }

        if (event.event_type === "scan.ai_typing") {
          appendStreamingActivity("scan", event.content || "");
          return;
        }

        if (event.event_type === "plan.ai_typing") {
          setAssistantDraft((prev) => prev + (event.content || ""));
          return;
        }

        if (event.session_snapshot) {
          setSnapshot(event.session_snapshot);
        }

        if (event.event_type === "session.error") {
          setChatError(event.session_snapshot?.last_error || "会话处理失败");
        } else {
          setChatError(null);
        }

        setAssistantDraft("");
      },
      onError: () => {
        setChatError("事件流已断开，请刷新当前会话。");
      },
    });

    return () => {
      cancelled = true;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [sessionId]);

  const stage = snapshot?.stage || "idle";
  const chatMessages = snapshot?.messages || [];
  const composerMode = useMemo(() => composerModeForStage(stage), [stage]);

  async function refreshSnapshot() {
    if (!sessionId) {
      return;
    }
    const response = await api.getSession(sessionId);
    setSnapshot(response.session_snapshot);
  }

  async function sendMessage(content: string) {
    if (!sessionId) {
      return;
    }

    const previousSnapshot = snapshotRef.current;
    if (previousSnapshot) {
      setSnapshot({
        ...previousSnapshot,
        messages: [
          ...previousSnapshot.messages,
          { id: createLocalMessageId("user"), role: "user", content },
        ],
      });
    }

    setLoading(true);
    setChatError(null);
    setAssistantDraft("");
    setActivityFeed([]);

    try {
      const response = await api.sendMessage(sessionId, content);
      setSnapshot(response.session_snapshot);
      setAssistantDraft("");
    } catch (err) {
      if (previousSnapshot) {
        setSnapshot(previousSnapshot);
      }
      setChatError(err instanceof Error ? err.message : "发送消息失败");
    } finally {
      setLoading(false);
    }
  }

  async function scan() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    resetConversationTransientState();
    try {
      const response = await api.scanSession(sessionId);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "启动扫描失败");
    } finally {
      setLoading(false);
    }
  }

  async function refreshPlan() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    resetConversationTransientState();
    try {
      const response = await api.refreshSession(sessionId);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "刷新扫描失败");
    } finally {
      setLoading(false);
    }
  }

  async function runPrecheck() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.runPrecheck(sessionId);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "预检失败");
    } finally {
      setLoading(false);
    }
  }

  async function execute() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    setActivityFeed([]);
    try {
      const response = await api.execute(sessionId, true);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "执行失败");
    } finally {
      setLoading(false);
    }
  }

  async function rollback() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    setActivityFeed([]);
    try {
      const response = await api.rollback(sessionId, true);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "回退失败");
    } finally {
      setLoading(false);
    }
  }

  async function cleanupEmptyDirs() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.cleanupEmptyDirs(sessionId);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "清理空目录失败");
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
      setChatError(err instanceof Error ? err.message : "放弃会话失败");
    } finally {
      setLoading(false);
    }
  }

  async function openExplorer(path: string) {
    try {
      await api.openDir(path);
    } catch {
      setChatError("无法打开文件夹: 路径不存在或系统错误");
    }
  }

  async function loadJournal() {
    if (!sessionId) {
      return;
    }
    try {
      setJournalLoading(true);
      setJournal(await api.getJournal(sessionId));
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "读取 journal 失败");
    } finally {
      setJournalLoading(false);
    }
  }

  async function updateItem(payload: { item_id: string; target_dir?: string; move_to_review?: boolean }) {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.updateItem(sessionId, payload);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "调整项目失败");
    } finally {
      setLoading(false);
    }
  }

  return {
    snapshot,
    stage,
    journal,
    journalLoading,
    loading,
    chatMessages,
    assistantDraft,
    activityFeed,
    chatError,
    composerMode,
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
    updateItem,
  };
}
