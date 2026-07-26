"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken, isTauriDesktop, waitForRuntimeConfig } from "@/lib/runtime";
import { getUserFacingErrorCode, localizeSessionLastError, localizeUserFacingError } from "@/lib/user-facing-copy";
import { getSessionStageView } from "@/lib/session-view-model";
import { createSessionEventStream, type SessionEventStream } from "@/lib/sse";
import type {
  AssistantMessage,
  PlannerProgress,
  AssistantRuntimeStatus,
  JournalSummary,
  RollbackPrecheckSummary,
  SessionEvent,
  SessionSnapshot,
  StreamStatus,
} from "@/types/session";

function createLocalMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function _nowLabel(): string {
  return new Date().toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const INITIAL_PLAN_REQUEST_PREFIX = "请基于上述的目录扫描结果和整理规则，为我生成整理计划。简要聊聊你为何这样计划，以及你对此目录的理解和分析。";
const TOOL_ONLY_PLAN_FALLBACK_REPLY = "我已经更新了整理计划，请您查看。";
const PLAN_FALLBACK_MESSAGE_ID = "local-plan-fallback";

function isInternalPlanRequest(content: string): boolean {
  return content.includes("请基于上述")
    && content.includes("目录扫描结果")
    && content.includes("整理规则")
    && (content.includes("生成整理计划") || content.includes("生成整理建议"))
    && content.includes("Markdown");
}

function shouldDisplayMessage(message: AssistantMessage): boolean {
  const role = String(message.role || "").trim();
  const content = String(message.content || "").trim();
  const visibility = String(message.visibility || "public").trim();

  if (visibility === "internal") {
    return false;
  }

  if (role === "system" || role === "tool") {
    return false;
  }

  if (role === "user" && (content.startsWith(INITIAL_PLAN_REQUEST_PREFIX) || isInternalPlanRequest(content))) {
    return false;
  }

  if (!content) {
    return false;
  }

  return role === "assistant" || role === "user";
}

function normalizeMessageContent(content: string): string {
  return String(content || "").replace(/\s+/g, " ").trim();
}

function collapseAdjacentDuplicateAssistantMessages(messages: AssistantMessage[]): AssistantMessage[] {
  const collapsed: AssistantMessage[] = [];
  for (const message of messages) {
    const previous = collapsed[collapsed.length - 1];
    const isDuplicateAssistant = previous
      && String(previous.role || "").trim() === "assistant"
      && String(message.role || "").trim() === "assistant"
      && normalizeMessageContent(previous.content) === normalizeMessageContent(message.content);

    if (isDuplicateAssistant) {
      collapsed[collapsed.length - 1] = message;
    } else {
      collapsed.push(message);
    }
  }
  return collapsed;
}

function collectSnapshotMessages(snapshot?: SessionSnapshot | null): AssistantMessage[] {
  if (!snapshot) {
    return [];
  }
  const messages = [...(snapshot.messages || [])];
  const assistantMessage = snapshot.assistant_message;
  if (!assistantMessage) {
    return messages;
  }

  const sameIdIndex = messages.findIndex((message) => message.id === assistantMessage.id);
  if (sameIdIndex >= 0) {
    messages[sameIdIndex] = assistantMessage;
    return messages;
  }

  const sameAssistantContentIndex = messages.findIndex((message) =>
    String(message.role || "").trim() === "assistant"
    && String(message.content || "") === String(assistantMessage.content || "")
  );
  if (sameAssistantContentIndex >= 0) {
    messages[sameAssistantContentIndex] = assistantMessage;
    return messages;
  }
  messages.push(assistantMessage);
  return messages;
}

function hasDisplayableAssistantReply(snapshot?: SessionSnapshot | null): boolean {
  const messages = collectSnapshotMessages(snapshot);
  return messages.some((message) => String(message.role || "").trim() === "assistant" && shouldDisplayMessage(message));
}

function hasPlanContent(snapshot?: SessionSnapshot | null): boolean {
  const plan = snapshot?.plan_snapshot;
  if (!plan) {
    return false;
  }
  return Boolean(
    (plan.items || []).length > 0
      || (plan.groups || []).length > 0
      || (plan.target_slots || []).length > 0
      || (plan.stats?.move_count || 0) > 0
      || (plan.stats?.unresolved_count || 0) > 0,
  );
}

function shouldShowPlanFallbackMessage(snapshot?: SessionSnapshot | null): boolean {
  if (!snapshot || !hasPlanContent(snapshot) || hasDisplayableAssistantReply(snapshot)) {
    return false;
  }
  return snapshot.stage === "planning"
    || snapshot.stage === "ready_for_precheck"
    || snapshot.stage === "ready_to_execute";
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
      label: phase === "scan" ? "正在读取文件内容" : "正在补充文件证据",
      detail: humanizeActionTarget(action.args?.filename) || "正在读取文件内容",
    };
  }

  if (action?.name === "list_local_files") {
    return {
      phase,
      mode: "tool",
      label: phase === "scan" ? "正在读取目录结构" : "正在检查目录上下文",
      detail: humanizeActionTarget(action.args?.directory) || "当前目录",
    };
  }

  if (action?.message) {
    const detail = phase === "scan"
      ? (action.args?.filename ? `正在处理 ${humanizeActionTarget(action.args.filename)}` : "正在处理文件，请稍候")
      : "正在整理目录结构与最新要求";
    return {
      phase,
      mode: "waiting",
      label: action.message,
      detail,
    };
  }

  return null;
}

function assistantRuntimeFromTyping(phase: "scan" | "plan"): AssistantRuntimeStatus {
  return phase === "scan"
    ? {
        phase,
        mode: "streaming",
        label: "正在输出扫描结果",
        detail: "正在整理结果",
      }
    : {
        phase,
        mode: "streaming",
        label: "正在生成整理建议",
        detail: "内容会持续更新到对话区",
      };
}

const IDLE_PLANNER_PROGRESS: PlannerProgress = {
  status: "idle",
  phase: null,
  message: "",
  detail: null,
  attempt: 1,
  started_at: null,
  updated_at: null,
  last_completed_at: null,
  preserving_previous_plan: false,
};

export interface PlannerStatusViewModel {
  status: string;
  phase: string | null;
  label: string;
  detail: string | null;
  attempt: number;
  elapsedLabel: string | null;
  reassureText: string | null;
  preservingPreviousPlan: boolean;
  isRunning: boolean;
}

function normalizePlannerProgress(progress?: PlannerProgress | null): PlannerProgress {
  return {
    ...IDLE_PLANNER_PROGRESS,
    ...(progress || {}),
    attempt: Math.max(1, Number(progress?.attempt || 1)),
    preserving_previous_plan: Boolean(progress?.preserving_previous_plan),
  };
}

function formatElapsedLabel(startedAt: string | null | undefined, nowMs: number): string | null {
  if (!startedAt) {
    return null;
  }
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) {
    return null;
  }
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  if (elapsedSeconds < 60) {
    return `已耗时 ${elapsedSeconds} 秒`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `已耗时 ${minutes} 分 ${seconds} 秒`;
}

function buildPlannerStatus(progress: PlannerProgress, nowMs: number): PlannerStatusViewModel {
  const normalized = normalizePlannerProgress(progress);
  const isRunning = normalized.status === "running";
  const elapsedLabel = isRunning ? formatElapsedLabel(normalized.started_at, nowMs) : null;
  const reassureText = (() => {
    if (!isRunning || !normalized.started_at) {
      return null;
    }
    const startedMs = Date.parse(normalized.started_at);
    if (!Number.isFinite(startedMs)) {
      return null;
    }
    const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
    return elapsedSeconds >= 30 ? "系统仍在处理中，请不要重复提交" : null;
  })();

  return {
    status: String(normalized.status || "idle"),
    phase: normalized.phase ? String(normalized.phase) : null,
    label: String(normalized.message || ""),
    detail: normalized.detail ? String(normalized.detail) : null,
    attempt: Math.max(1, Number(normalized.attempt || 1)),
    elapsedLabel,
    reassureText,
    preservingPreviousPlan: Boolean(normalized.preserving_previous_plan),
    isRunning,
  };
}

export function useSession(sessionId: string | null) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [journal, setJournal] = useState<JournalSummary | null>(null);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatErrorCode, setChatErrorCode] = useState<string | null>(null);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [assistantRuntime, setAssistantRuntime] = useState<AssistantRuntimeStatus | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("offline");
  const [plannerClock, setPlannerClock] = useState(() => Date.now());
  const streamRef = useRef<SessionEventStream | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const offlineTimerRef = useRef<number | null>(null);
  const planReplyFallbackPendingRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const applySnapshot = useCallback((next: SessionSnapshot | null) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const resetConversationTransientState = useCallback(() => {
    setAssistantDraft("");
    setAssistantRuntime(null);
    setChatError(null);
    setChatErrorCode(null);
  }, []);

  const applyChatError = useCallback((error: unknown, fallback: string) => {
    setChatError(localizeUserFacingError(error, fallback));
    setChatErrorCode(getUserFacingErrorCode(error));
  }, []);

  const clearOfflineTimer = useCallback(() => {
    if (offlineTimerRef.current !== null) {
      window.clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = null;
    }
  }, []);

  const scheduleOfflineState = useCallback(() => {
    clearOfflineTimer();
    offlineTimerRef.current = window.setTimeout(() => {
      setStreamStatus((current) => (current === "connected" ? current : "offline"));
    }, 5000);
  }, [clearOfflineTimer]);

  const closeStream = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    hasConnectedRef.current = false;
  }, []);

  // 流式 typing 事件每个 token 都会到达一次；若每次都整体替换 snapshot，
  // 下游依赖 plan_snapshot 引用的 useMemo（预览树等）会在每个 token 上全部失效。
  // 只有当阶段或规划进度等标量里程碑变化时才应用 typing 事件附带的 snapshot。
  const shouldApplyTypingSnapshot = useCallback((next: SessionSnapshot): boolean => {
    const current = snapshotRef.current;
    if (!current) {
      return true;
    }
    const currentProgress = current.planner_progress;
    const nextProgress = next.planner_progress;
    return current.stage !== next.stage
      || currentProgress?.status !== nextProgress?.status
      || currentProgress?.phase !== nextProgress?.phase
      || currentProgress?.attempt !== nextProgress?.attempt
      || (current.messages?.length || 0) !== (next.messages?.length || 0);
  }, []);

  const handleStreamEvent = useCallback((event: SessionEvent) => {
    clearOfflineTimer();
    hasConnectedRef.current = true;
    setStreamStatus("connected");
    const snapshotPlannerProgress = normalizePlannerProgress(event.session_snapshot?.planner_progress);
    const shouldPreserveAssistantDraft = snapshotPlannerProgress.status === "running" && snapshotPlannerProgress.phase === "streaming_reply";
    if (snapshotPlannerProgress.status === "running" && runtimePhaseFromEvent(event) === "plan") {
      planReplyFallbackPendingRef.current = true;
    }

    if (event.event_type === "scan.started") {
      setAssistantRuntime({
        phase: "scan",
        mode: "waiting",
        label: "初始化扫描会话",
        detail: "正在连接后端并准备文件索引...",
      });
    }

    if (event.event_type === "scan.action" || event.event_type === "plan.action") {
      if (event.event_type === "plan.action") {
        planReplyFallbackPendingRef.current = true;
      }
      if (event.session_snapshot) {
        setSnapshot(event.session_snapshot);
      }
      const runtime = assistantRuntimeFromAction(event);
      if (runtime) {
        setAssistantRuntime(runtime);
      }
      return;
    }

    if (event.event_type === "scan.ai_typing") {
      if (event.session_snapshot && shouldApplyTypingSnapshot(event.session_snapshot)) {
        applySnapshot(event.session_snapshot);
      }
      setAssistantRuntime(assistantRuntimeFromTyping("scan"));
      return;
    }

    if (event.event_type === "plan.ai_typing") {
      planReplyFallbackPendingRef.current = true;
      if (event.session_snapshot && shouldApplyTypingSnapshot(event.session_snapshot)) {
        applySnapshot(event.session_snapshot);
      }
      setAssistantRuntime(assistantRuntimeFromTyping("plan"));
      setAssistantDraft((prev) => prev + (event.content || ""));
      return;
    }

    if (event.session_snapshot) {
      applySnapshot(event.session_snapshot);
      if (event.session_snapshot.stage !== "interrupted" && event.event_type !== "session.error") {
        setChatError(null);
        setChatErrorCode(null);
      }
    }

    if (event.event_type === "session.error" || event.event_type === "session.interrupted") {
      setAssistantRuntime(null);
      const snapshotError = event.session_snapshot?.last_error;
      if (snapshotError) {
        setChatError(localizeSessionLastError(snapshotError));
        setChatErrorCode(null);
      } else if (event.event_type === "session.error") {
        setChatError("会话处理失败");
        setChatErrorCode(null);
      }
    } else if (event.event_type === "scan.completed") {
      setAssistantRuntime((current) => (current?.phase === "scan" ? null : current));
    } else if (event.event_type === "plan.updated") {
      setAssistantRuntime((current) => (current?.phase === "plan" ? null : current));
    } else {
      setChatError(null);
      setChatErrorCode(null);
    }

    const shouldShowToolOnlyFallback =
      event.event_type === "plan.updated"
      && planReplyFallbackPendingRef.current
      && !hasDisplayableAssistantReply(event.session_snapshot);

    if (!shouldPreserveAssistantDraft) {
      setAssistantDraft((current) => {
        if (shouldShowToolOnlyFallback) {
          return current.trim() ? current : TOOL_ONLY_PLAN_FALLBACK_REPLY;
        }
        return "";
      });
    }

    if (event.event_type === "plan.updated" || event.event_type === "session.error" || event.event_type === "session.interrupted") {
      planReplyFallbackPendingRef.current = false;
    }
  }, [clearOfflineTimer]);

  const connectStream = useCallback((
    nextSessionId: string,
    initialStatus: Extract<StreamStatus, "connecting" | "reconnecting"> = "connecting",
  ) => {
    closeStream();
    setStreamStatus(initialStatus);
    scheduleOfflineState();

    streamRef.current = createSessionEventStream({
      baseUrl: getApiBaseUrl(),
      sessionId: nextSessionId,
      accessToken: getApiToken(),
      onEvent: handleStreamEvent,
      onError: () => {
        setStreamStatus(hasConnectedRef.current ? "reconnecting" : initialStatus);
        scheduleOfflineState();
      },
    });
  }, [closeStream, handleStreamEvent, scheduleOfflineState]);

  useEffect(() => {
    if (!sessionId) {
      closeStream();
      clearOfflineTimer();
      setSnapshot(null);
      setJournal(null);
      setJournalLoading(false);
      setJournalError(null);
      setLoading(false);
      setStreamStatus("offline");
      resetConversationTransientState();
      return;
    }

    let cancelled = false;
    setLoading(true);
    setJournal(null);
    setJournalLoading(false);
    setJournalError(null);
    resetConversationTransientState();
    void (async () => {
      try {
        if (isTauriDesktop()) {
          await waitForRuntimeConfig();
          if (cancelled) {
            return;
          }
        }

        connectStream(sessionId);
        const response = await api.getSession(sessionId);
        if (!cancelled && response.session_snapshot) {
          applySnapshot(response.session_snapshot);
        }
      } catch (err) {
        if (!cancelled) {
          applyChatError(err, "读取任务失败，请稍后再试。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      closeStream();
      clearOfflineTimer();
    };
  }, [api, applyChatError, applySnapshot, clearOfflineTimer, closeStream, connectStream, resetConversationTransientState, sessionId]);

  const stage = snapshot?.stage || "idle";
  const stageView = useMemo(() => getSessionStageView(stage), [stage]);
  const plannerProgress = useMemo(() => {
    if (!stageView.isPlanningConversation) {
      return IDLE_PLANNER_PROGRESS;
    }
    return normalizePlannerProgress(snapshot?.planner_progress);
  }, [snapshot?.planner_progress, stageView.isPlanningConversation]);
  const plannerStatus = useMemo(
    () => buildPlannerStatus(plannerProgress, plannerClock),
    [plannerClock, plannerProgress],
  );
  const chatMessages = useMemo(() => {
    const visibleMessages = collapseAdjacentDuplicateAssistantMessages(
      collectSnapshotMessages(snapshot).filter(shouldDisplayMessage),
    );
    if (!assistantDraft.trim() && shouldShowPlanFallbackMessage(snapshot)) {
      return [
        ...visibleMessages,
        {
          id: PLAN_FALLBACK_MESSAGE_ID,
          role: "assistant",
          content: TOOL_ONLY_PLAN_FALLBACK_REPLY,
        },
      ];
    }
    return visibleMessages;
  }, [assistantDraft, snapshot]);
  const composerMode = stageView.composerMode;
  const composerStatus = useMemo<AssistantRuntimeStatus | null>(() => {
    if (plannerStatus.isRunning && composerMode === "editable") {
      return {
        phase: "plan",
        mode: plannerStatus.phase === "streaming_reply" ? "streaming" : "waiting",
        label: plannerStatus.label,
        detail: [plannerStatus.detail, plannerStatus.elapsedLabel].filter(Boolean).join(" · ") || undefined,
      };
    }
    if (assistantRuntime?.phase === "plan") {
      return assistantRuntime;
    }
    if (loading && composerMode === "editable") {
      return {
        phase: "plan",
        mode: "waiting",
        label: "正在处理当前调整",
        detail: "完成后会自动恢复输入",
      };
    }
    return null;
  }, [assistantRuntime, composerMode, loading, plannerStatus]);
  const isComposerLocked = composerMode === "editable" && Boolean(composerStatus);

  useEffect(() => {
    if (!plannerStatus.isRunning || !plannerProgress.started_at) {
      return;
    }
    const timer = window.setInterval(() => {
      setPlannerClock(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [plannerProgress.started_at, plannerStatus.isRunning]);

  useEffect(() => {
    setAssistantRuntime((current) => {
      if (!current) {
        return current;
      }
      if (current.phase === "scan" && !stageView.isScanning) {
        return null;
      }
      if (current.phase === "plan" && !stageView.isPlanningConversation) {
        return null;
      }
      return current;
    });
  }, [stageView]);

  const refreshSnapshot = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    const response = await api.getSession(sessionId);
    applySnapshot(response.session_snapshot);
  }, [api, applySnapshot, sessionId]);

  const retryStream = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    if (isTauriDesktop()) {
      await waitForRuntimeConfig();
    }
    connectStream(sessionId, "connecting");
    try {
      await refreshSnapshot();
    } catch (err) {
      applyChatError(err, "重新连接后仍无法同步当前任务。");
    }
  }, [applyChatError, connectStream, refreshSnapshot, sessionId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!sessionId) {
      return;
    }

    const previousSnapshot = snapshotRef.current;
    if (previousSnapshot) {
      applySnapshot({
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
    planReplyFallbackPendingRef.current = true;
    setAssistantRuntime({
      phase: "plan",
      mode: "waiting",
      label: "正在整理新的调整意见",
      detail: "正在结合目录状态与最新要求更新方案",
    });

    try {
      const response = await api.sendMessage(sessionId, content);
      applySnapshot(response.session_snapshot);
      setAssistantDraft("");
    } catch (err) {
      if (previousSnapshot) {
        applySnapshot(previousSnapshot);
      }
      setAssistantRuntime(null);
      applyChatError(err, "发送调整意见失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, sessionId]);

  const scan = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    resetConversationTransientState();
    setAssistantRuntime({
      phase: "scan",
      mode: "waiting",
      label: "正在建立扫描任务",
      detail: "正在读取目录结构并建立文件索引",
    });
    try {
      const response = await api.scanSession(sessionId);
      applySnapshot(response.session_snapshot);
    } catch (err) {
      setAssistantRuntime(null);
      applyChatError(err, "启动扫描失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, resetConversationTransientState, sessionId]);

  const refreshPlan = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    resetConversationTransientState();
    planReplyFallbackPendingRef.current = true;
    try {
      const response = await api.refreshSession(sessionId);
      applySnapshot(response.session_snapshot);
    } catch (err) {
      applyChatError(err, "刷新当前任务失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, resetConversationTransientState, sessionId]);

  const confirmTargetDirectories = useCallback(async (selectedTargetDirs: string[]) => {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    setAssistantDraft("");
    planReplyFallbackPendingRef.current = true;
    setAssistantRuntime({
      phase: "plan",
      mode: "waiting",
      label: "正在确认目标目录",
      detail: "系统会按显式目标目录配置扫描剩余待整理项",
    });
    try {
      const response = await api.confirmTargetDirectories(sessionId, {
        selected_target_dirs: selectedTargetDirs,
      });
      applySnapshot(response.session_snapshot);
      setAssistantDraft("");
    } catch (err) {
      setAssistantRuntime(null);
      applyChatError(err, "确认目标目录失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, sessionId]);

  const runPrecheck = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.runPrecheck(sessionId);
      applySnapshot(response.session_snapshot);
    } catch (err) {
      applyChatError(err, "执行检查失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, sessionId]);

  const applyTargetConflictSuggestions = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.applyTargetConflictSuggestions(sessionId);
      applySnapshot(response.session_snapshot);
    } catch (err) {
      applyChatError(err, "应用冲突建议失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, sessionId]);

  const returnToPlanning = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.returnToPlanning(sessionId);
      applySnapshot(response.session_snapshot);
    } catch (err) {
      applyChatError(err, "返回方案调整阶段失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, sessionId]);

  const execute = useCallback(async (): Promise<boolean> => {
    if (!sessionId) {
      return false;
    }
    setLoading(true);
    setChatError(null);
    setAssistantDraft("");
    try {
      const response = await api.execute(sessionId, true);
      applySnapshot(response.session_snapshot);
      return true;
    } catch (err) {
      applyChatError(err, "执行整理失败，请重试。");
      return false;
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, sessionId]);

  const prepareRollback = useCallback(async (): Promise<RollbackPrecheckSummary | null> => {
    if (!sessionId) {
      return null;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.rollback(sessionId, false);
      applySnapshot(response.session_snapshot);
      if (!response.rollback_precheck) {
        setChatError("回退预检没有返回可确认的信息，请重试。");
        return null;
      }
      return response.rollback_precheck;
    } catch (err) {
      applyChatError(err, "回退预检失败，请重试。");
      return null;
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, sessionId]);

  const confirmRollback = useCallback(async (): Promise<boolean> => {
    if (!sessionId) {
      return false;
    }
    setLoading(true);
    setChatError(null);
    setAssistantDraft("");
    try {
      const response = await api.rollback(sessionId, true);
      applySnapshot(response.session_snapshot);
      return true;
    } catch (err) {
      applyChatError(err, "执行回退失败，请重试。");
      return false;
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, sessionId]);

  const rollback = useCallback(async (): Promise<boolean> => {
    return confirmRollback();
  }, [confirmRollback]);

  const cleanupEmptyDirs = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.cleanupEmptyDirs(sessionId);
      applySnapshot(response.session_snapshot);
    } catch (err) {
      applyChatError(err, "清理空目录失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, sessionId]);

  const abandonSession = useCallback(async (): Promise<boolean> => {
    if (!sessionId) {
      return true;
    }
    setLoading(true);
    try {
      await api.abandonSession(sessionId);
      resetConversationTransientState();
      return true;
    } catch (err) {
      applyChatError(err, "结束当前任务失败，请重试。");
      return false;
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, resetConversationTransientState, sessionId]);

  const openExplorer = useCallback(async (path: string) => {
    try {
      await api.openDir(path);
    } catch {
      setChatError("暂时无法打开该目录。");
    }
  }, [api]);

  const loadJournal = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    try {
      setJournalLoading(true);
      setJournalError(null);
      setJournal(await api.getJournal(sessionId));
    } catch (err) {
      setJournalError(localizeUserFacingError(err, "读取执行记录失败。"));
    } finally {
      setJournalLoading(false);
    }
  }, [api, sessionId]);

  const updateItem = useCallback(async (payload: { item_id: string; target_dir?: string; target_slot?: string; move_to_review?: boolean }) => {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.updateItem(sessionId, payload);
      applySnapshot(response.session_snapshot);
    } catch (err) {
      applyChatError(err, "更新条目去向失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, sessionId]);

  const restoreAiSuggestion = useCallback(async (itemId: string) => {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setChatError(null);
    try {
      const response = await api.restoreAiSuggestion(sessionId, itemId);
      applySnapshot(response.session_snapshot);
    } catch (err) {
      applyChatError(err, "恢复 AI 建议失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [api, applyChatError, applySnapshot, sessionId]);

  return {
    snapshot,
    stage,
    journal,
    journalLoading,
    journalError,
    loading,
    chatMessages,
    assistantDraft,
    assistantRuntime,
    plannerProgress,
    plannerStatus,
    composerStatus,
    chatError,
    chatErrorCode,
    streamStatus,
    composerMode,
    isComposerLocked,
    refreshSnapshot,
    retryStream,
    sendMessage,
    scan,
    refreshPlan,
    confirmTargetDirectories,
    runPrecheck,
    applyTargetConflictSuggestions,
    returnToPlanning,
    execute,
    prepareRollback,
    confirmRollback,
    rollback,
    cleanupEmptyDirs,
    abandonSession,
    openExplorer,
    loadJournal,
    updateItem,
    restoreAiSuggestion,
  };
}
