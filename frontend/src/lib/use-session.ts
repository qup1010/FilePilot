"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { createSessionEventStream, type SessionEventStream } from "@/lib/sse";
import type {
  AssistantMessage,
  AssistantRuntimeStatus,
  ComposerMode,
  JournalSummary,
  SessionEvent,
  SessionSnapshot,
  SessionStage,
  StreamStatus,
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

const INITIAL_PLAN_REQUEST_PREFIX = "请基于上述的目录扫描结果和整理规则，为我生成整理计划。简要聊聊你为何这样计划，以及你对此目录的理解和分析。";

function shouldDisplayMessage(message: AssistantMessage): boolean {
  const role = String(message.role || "").trim();
  const content = String(message.content || "").trim();
  const hasBlocks = Array.isArray(message.blocks) && message.blocks.length > 0;

  if (role === "system" || role === "tool") {
    return false;
  }

  if (role === "user" && content.startsWith(INITIAL_PLAN_REQUEST_PREFIX)) {
    return false;
  }

  if (!content && !hasBlocks) {
    return false;
  }

  return role === "assistant" || role === "user";
}

function humanizeActionTarget(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === ".") {
    return "当前目录";
  }
  const normalized = trimmed.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) || trimmed;
}

function runtimePhaseFromEvent(event: SessionEvent): "scan" | "plan" {
  return event.event_type.startsWith("scan.") ? "scan" : "plan";
}

function assistantRuntimeFromAction(event: SessionEvent): AssistantRuntimeStatus | null {
  const action = event.action as any;
  if (!action) {
    return null;
  }

  const phase = runtimePhaseFromEvent(event);
  if (action?.name === "read_local_file") {
    return {
      phase,
      mode: "tool",
      label: phase === "scan" ? "正在读取文件内容" : "正在读取补充证据",
      detail: humanizeActionTarget(action.args?.filename) || "文件内容读取中",
    };
  }

  if (action?.name === "list_local_files") {
    return {
      phase,
      mode: "tool",
      label: phase === "scan" ? "正在查看目录结构" : "正在检查目录上下文",
      detail: humanizeActionTarget(action.args?.directory) || "当前目录",
    };
  }

  if (action?.message) {
    return {
      phase,
      mode: "waiting",
      label: action.message,
      detail:
        phase === "scan"
          ? "文件较多时，这一步可能持续更久"
          : "请稍等，模型正在组织新的整理建议",
    };
  }

  return null;
}

function assistantRuntimeFromTyping(phase: "scan" | "plan"): AssistantRuntimeStatus {
  return phase === "scan"
    ? {
        phase,
        mode: "streaming",
        label: "扫描模型正在输出分析结果",
        detail: "正在整理本轮扫描结论",
      }
    : {
        phase,
        mode: "streaming",
        label: "正在生成整理回复",
        detail: "回复内容会持续追加到对话区",
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
  const [assistantRuntime, setAssistantRuntime] = useState<AssistantRuntimeStatus | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("disconnected");
  const streamRef = useRef<SessionEventStream | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const api = createApiClient(getApiBaseUrl(), getApiToken());

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  function resetConversationTransientState() {
    setAssistantDraft("");
    setAssistantRuntime(null);
    setChatError(null);
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
      accessToken: getApiToken(),
      onEvent: (event) => {
        setStreamStatus("connected");

        if (event.event_type === "scan.started") {
          setAssistantRuntime({
            phase: "scan",
            mode: "waiting",
            label: "正在准备扫描",
            detail: "先读取目录结构和基础摘要",
          });
        }

        if (event.event_type === "scan.action" || event.event_type === "plan.action") {
          const runtime = assistantRuntimeFromAction(event);
          if (runtime) {
            setAssistantRuntime(runtime);
          }
          return;
        }

        if (event.event_type === "scan.ai_typing") {
          setAssistantRuntime(assistantRuntimeFromTyping("scan"));
          return;
        }

        if (event.event_type === "plan.ai_typing") {
          setAssistantRuntime(assistantRuntimeFromTyping("plan"));
          setAssistantDraft((prev) => prev + (event.content || ""));
          return;
        }

        if (event.session_snapshot) {
          setSnapshot(event.session_snapshot);
        }

        if (event.event_type === "session.error" || event.event_type === "session.interrupted") {
          setAssistantRuntime(null);
          const snapshotError = event.session_snapshot?.last_error;
          if (snapshotError) {
             setChatError(snapshotError);
          } else if (event.event_type === "session.error") {
             setChatError("会话处理失败");
          }
        } else if (event.event_type === "scan.completed") {
          setAssistantRuntime((current) => (current?.phase === "scan" ? null : current));
        } else if (event.event_type === "plan.updated") {
          setAssistantRuntime((current) => (current?.phase === "plan" ? null : current));
        } else {
          setChatError(null);
        }

        setAssistantDraft("");
      },
      onError: () => {
        setStreamStatus("connecting");
      },
    });

    return () => {
      cancelled = true;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [sessionId]);

  const stage = snapshot?.stage || "idle";
  const chatMessages = useMemo(
    () => (snapshot?.messages || []).filter(shouldDisplayMessage),
    [snapshot?.messages],
  );
  const composerMode = useMemo(() => composerModeForStage(stage), [stage]);
  const composerStatus = useMemo<AssistantRuntimeStatus | null>(() => {
    if (assistantRuntime?.phase === "plan") {
      return assistantRuntime;
    }
    if (loading && composerMode === "editable") {
      return {
        phase: "plan",
        mode: "waiting",
        label: "正在处理当前请求",
        detail: "请稍等，完成后会自动恢复输入",
      };
    }
    return null;
  }, [assistantRuntime, loading, composerMode]);
  const isComposerLocked = composerMode === "editable" && Boolean(composerStatus);

  useEffect(() => {
    setAssistantRuntime((current) => {
      if (!current) {
        return current;
      }
      if (current.phase === "scan" && stage !== "scanning") {
        return null;
      }
      if (current.phase === "plan" && stage !== "planning" && stage !== "ready_for_precheck") {
        return null;
      }
      return current;
    });
  }, [stage]);

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
    setAssistantRuntime({
      phase: "plan",
      mode: "waiting",
      label: "正在等待模型回复",
      detail: "这一步可能持续数秒到几十秒",
    });

    try {
      const response = await api.sendMessage(sessionId, content);
      setSnapshot(response.session_snapshot);
      setAssistantDraft("");
    } catch (err) {
      if (previousSnapshot) {
        setSnapshot(previousSnapshot);
      }
      setAssistantRuntime(null);
      setChatError(err instanceof Error ? err.message : "发送消息失败");
    } finally {
      setLoading(false);
    }
  }

  async function resolveUnresolvedChoices(payload: { request_id: string; resolutions: { item_id: string; selected_folder: string; note: string }[] }) {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.resolveUnresolvedChoices(sessionId, payload);
      setSnapshot(response.session_snapshot);
      setAssistantDraft("");

      // 自动发送确认消息给 AI
      const summary = payload.resolutions.map(r => {
        return `· 【${r.item_id}】归类至：${r.selected_folder}${r.note ? ` (${r.note})` : ""}`;
      }).join("\n");
      
      await sendMessage(`我已经完成了以下项的归类：\n${summary}\n请根据这些选择更新整理方案。`);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "没有提交成功，请再试一次。");
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
    setAssistantRuntime({
      phase: "scan",
      mode: "waiting",
      label: "正在准备扫描",
      detail: "先读取目录结构和基础摘要",
    });
    try {
      const response = await api.scanSession(sessionId);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setAssistantRuntime(null);
      setChatError(err instanceof Error ? err.message : "没有开始扫描，请再试一次。");
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
      setChatError(err instanceof Error ? err.message : "没有刷新成功，请再试一次。");
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
      setChatError(err instanceof Error ? err.message : "预检没有成功，请再试一次。");
    } finally {
      setLoading(false);
    }
  }

  async function returnToPlanning() {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.returnToPlanning(sessionId);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "没有返回成功，请再试一次。");
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
    setAssistantDraft("");
    try {
      const response = await api.execute(sessionId, true);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "执行没有成功，请再试一次。");
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
    setAssistantDraft("");
    try {
      const response = await api.rollback(sessionId, true);
      setSnapshot(response.session_snapshot);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "回退没有成功，请再试一次。");
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
      setChatError(err instanceof Error ? err.message : "没有清理成功，请再试一次。");
    } finally {
      setLoading(false);
    }
  }

  async function abandonSession(): Promise<boolean> {
    if (!sessionId) {
      return true;
    }
    setLoading(true);
    try {
      await api.abandonSession(sessionId);
      resetConversationTransientState();
      return true;
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "没有结束成功，请再试一次。");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function openExplorer(path: string) {
    try {
      await api.openDir(path);
    } catch {
      setChatError("现在还不能打开这个文件夹。");
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
    assistantRuntime,
    composerStatus,
    chatError,
    streamStatus,
    composerMode,
    isComposerLocked,
    refreshSnapshot,
    sendMessage,
    resolveUnresolvedChoices,
    scan,
    refreshPlan,
    runPrecheck,
    returnToPlanning,
    execute,
    rollback,
    cleanupEmptyDirs,
    abandonSession,
    openExplorer,
    loadJournal,
    updateItem,
  };
}
