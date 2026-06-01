"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, FolderPlus, FolderTree, Layers, ListChecks, Loader2, LogOut, PanelLeftClose, PanelLeftOpen, RefreshCw, ShieldAlert } from "lucide-react";
import { getSessionStageView } from "@/lib/session-view-model";
import { cn } from "@/lib/utils";
import { canRunPrecheck as deriveCanRunPrecheck } from "@/lib/workspace-precheck";

import { useSession } from "@/lib/use-session";
import { getFriendlyStage } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { EmptyState } from "@/components/ui/empty-state";
import { FileRadarIllustration } from "@/components/ui/svg-illustrations";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createApiClient } from "@/lib/api";
import { localizeSessionLastError } from "@/lib/user-facing-copy";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { notifyWorkspaceWhenAway, requestWorkspaceNotificationPermission } from "@/lib/workspace-notifications";
import { getWorkspaceRouteForSnapshot, getWorkspaceViewForSnapshot, hasStablePlan, type WorkspaceView } from "@/lib/workspace-routes";
import { MinimalScanningView } from "./workspace/minimal-scanning-view";
import type { WorkspaceProgressPhase } from "@/lib/scanner-progress-view";
import { PrecheckView } from "./workspace/precheck-view";
import { CompletionView } from "./workspace/completion-view";
import { ConversationPanel, type ConversationNotice } from "./workspace/conversation-panel";
import { IncrementalSelectionView } from "./workspace/incremental-selection-view";
import { PreviewFilter, PreviewFocusRequest, PreviewPanel } from "./workspace/preview-panel";
import { RollbackPreviewDialog } from "./workspace/rollback-preview-dialog";
import type { RollbackPrecheckSummary } from "@/types/session";

const DEFAULT_LEFT_WIDTH = 50;
const SCAN_PREVIEW_GRACE_MS = 1200;
const COMPACT_WORKSPACE_BREAKPOINT = 1100;
type InitialAutoPlanUiState = "idle" | "pending" | "revealing" | "done";
type WorkspacePipelineStepState = "done" | "active" | "pending" | "blocked";

interface WorkspacePipelineStep {
  id: string;
  label: string;
  state: WorkspacePipelineStepState;
}

interface WorkspacePrimaryNotice extends ConversationNotice {
  stageLabel: string;
  steps: WorkspacePipelineStep[];
}

function getSessionIdFromWorkspaceRoute(route: string | null): string | null {
  if (!route?.startsWith("/workspace")) {
    return null;
  }
  const query = route.split("?")[1] || "";
  return new URLSearchParams(query).get("session_id");
}

function summarizeItemNames(names: string[], limit = 3): string {
  const visible = names.filter(Boolean).slice(0, limit);
  if (!visible.length) {
    return "";
  }
  return visible.join("、") + (names.length > limit ? ` 等 ${names.length} 项` : "");
}

function displayNameFromPath(path: string): string {
  const normalized = String(path || "").replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || "未知条目";
}

function formatDirName(path: string | null | undefined): string {
  const trimmed = String(path || "").trim();
  if (!trimmed) {
    return "当前任务";
  }
  try {
    const decoded = decodeURIComponent(trimmed);
    if (/^[a-zA-Z]:[\\/]?$/.test(decoded)) {
      const letter = decoded[0].toUpperCase();
      return `${letter}:\\`;
    }
    if (decoded === "/" || decoded === "\\") {
      return "/";
    }
    const normalized = decoded.replace(/[\\/]$/, "");
    return normalized.split(/[\\/]/).pop() || "当前任务";
  } catch {
    const normalized = trimmed.replace(/[\\/]$/, "");
    return normalized.split(/[\\/]/).pop() || "当前任务";
  }
}

function deriveWorkspacePipeline(stageView: ReturnType<typeof getSessionStageView>, progressPhase: WorkspaceProgressPhase): WorkspacePipelineStep[] {
  const isRecovery = stageView.isRecovery;
  return [
    {
      id: "scan",
      label: "读取目录",
      state: stageView.isDraftLike
        ? "pending"
        : stageView.isScanning || progressPhase === "discovering" || progressPhase === "analyzing"
          ? "active"
          : isRecovery
            ? "blocked"
            : "done",
    },
    {
      id: "plan",
      label: "生成方案",
      state: progressPhase === "planning" || stageView.isPlanning
        ? "active"
        : stageView.isAwaitingPrecheck || stageView.isReadyToExecute || stageView.isExecuting || stageView.isCompleted
          ? "done"
          : progressPhase === "stranded" || isRecovery
            ? "blocked"
            : "pending",
    },
    {
      id: "precheck",
      label: "安全检查",
      state: stageView.isReadyToExecute || stageView.isExecuting || stageView.isCompleted
        ? "done"
        : stageView.isAwaitingPrecheck
          ? "active"
          : isRecovery
            ? "blocked"
            : "pending",
    },
    {
      id: "execute",
      label: "执行整理",
      state: stageView.isCompleted
        ? "done"
        : stageView.isExecuting
          ? "active"
          : isRecovery
            ? "blocked"
            : "pending",
    },
  ];
}

export default function WorkspaceClient({ view = "progress" }: { view?: WorkspaceView }) {
  const APP_CONTEXT_EVENT = "file-pilot-context-change";
  const WORKSPACE_CONTEXT_KEY = "workspace_header_context";
  const ACTIVE_WORKSPACE_ROUTE_KEY = "workspace_active_route";
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionIdParam = searchParams.get("session_id");
  const dirParam = searchParams.get("dir");
  const isReadOnly = searchParams.get("readonly") === "1";
  const autoStartScan = searchParams.get("auto_scan") === "1";

  const {
    snapshot,
    stage,
    journal,
    journalLoading,
    loading,
    chatMessages,
    assistantDraft,
    assistantRuntime,
    plannerStatus,
    composerStatus,
    chatError,
    chatErrorCode,
    streamStatus,
    composerMode,
    isComposerLocked,
    retryStream,
    sendMessage,
    scan,
    confirmTargetDirectories,
    runPrecheck,
    applyTargetConflictSuggestions,
    returnToPlanning,
    execute,
    prepareRollback,
    confirmRollback,
    cleanupEmptyDirs,
    abandonSession,
    openExplorer,
    loadJournal,
    updateItem,
    restoreAiSuggestion,
  } = useSession(sessionIdParam);

  const [globalConfig, setGlobalConfig] = useState<any>(null);
  const [configLoading, setConfigLoading] = useState(true);

  React.useEffect(() => {
    const api = createApiClient(getApiBaseUrl(), getApiToken());
    api.getSettings().then(data => {
      setGlobalConfig(data.status);
    }).finally(() => {
      setConfigLoading(false);
    });
  }, []);

  const isTextModelConfigured = useMemo(() => {
    if (!globalConfig) return true; // Default to true while loading to avoid flash
    return Boolean(globalConfig.text_configured);
  }, [globalConfig]);

  const [messageInput, setMessageInput] = useState("");
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [layoutReady, setLayoutReady] = useState(view !== "plan");
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [executeConfirmOpen, setExecuteConfirmOpen] = useState(false);
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false);
  const [rollbackPrecheck, setRollbackPrecheck] = useState<RollbackPrecheckSummary | null>(null);
  const [scanAbortConfirmOpen, setScanAbortConfirmOpen] = useState(false);
  const [scanAborting, setScanAborting] = useState(false);
  const [showExitMenu, setShowExitMenu] = useState(false);
  const [dividerLeft, setDividerLeft] = useState<number | null>(null);
  const [previewFocusRequest, setPreviewFocusRequest] = useState<PreviewFocusRequest | null>(null);
  const [scanPreviewHoldUntil, setScanPreviewHoldUntil] = useState<number | null>(null);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [compactConversationOpen, setCompactConversationOpen] = useState(false);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [initialAutoPlanUiState, setInitialAutoPlanUiState] = useState<InitialAutoPlanUiState>("idle");
  const [initialAutoPlanRevealMessageId, setInitialAutoPlanRevealMessageId] = useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const dividerRef = React.useRef<HTMLDivElement>(null);
  const leftPaneRef = React.useRef<HTMLElement>(null);
  const rightPaneRef = React.useRef<HTMLElement>(null);
  const draggedWidthRef = React.useRef(DEFAULT_LEFT_WIDTH);
  const [isResizingState, setIsResizingState] = useState(false);
  const isResizing = React.useRef(false);
  const scanPreviewTimerRef = React.useRef<number | null>(null);
  const autoScanRequestedRef = React.useRef(false);
  const previousScannerStatusRef = React.useRef("idle");
  const lastNavigatedRouteRef = React.useRef<string | null>(null);
  const taskNotificationRef = React.useRef({
    initialized: false,
    wasScanning: false,
    wasPlanning: false,
    lastPlanStartedAt: null as string | null,
  });

  React.useEffect(() => {
    autoScanRequestedRef.current = false;
    setInitialAutoPlanUiState("idle");
    setInitialAutoPlanRevealMessageId(null);
  }, [sessionIdParam]);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("workspace_sidebar_width");
      if (saved) {
        const val = parseFloat(saved);
        if (val > 32 && val < 72) {
          setLeftWidth(val);
        }
      }
    } finally {
      setLayoutReady(true);
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncLayoutMode = () => {
      const compact = window.innerWidth < COMPACT_WORKSPACE_BREAKPOINT;
      setIsCompactLayout(compact);
      if (compact) {
        setCompactConversationOpen(false);
      }
    };

    syncLayoutMode();
    window.addEventListener("resize", syncLayoutMode);
    return () => {
      window.removeEventListener("resize", syncLayoutMode);
    };
  }, []);

  React.useEffect(() => {
    if (chatErrorCode === "SESSION_NOT_FOUND") {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(ACTIVE_WORKSPACE_ROUTE_KEY);
        window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
      }
      router.push("/");
    }
  }, [ACTIVE_WORKSPACE_ROUTE_KEY, APP_CONTEXT_EVENT, chatErrorCode, router]);

  const saveWidth = React.useCallback((width: number) => {
    localStorage.setItem("workspace_sidebar_width", width.toString());
  }, []);

  const scanner = useMemo(
    () => ({
      status: snapshot?.scanner_progress?.status || "idle",
      processed_count: snapshot?.scanner_progress?.processed_count || 0,
      total_count: snapshot?.scanner_progress?.total_count || 0,
      current_item: snapshot?.scanner_progress?.current_item || null,
      recent_analysis_items: snapshot?.scanner_progress?.recent_analysis_items || [],
      batch_count: snapshot?.scanner_progress?.batch_count,
      completed_batches: snapshot?.scanner_progress?.completed_batches,
      message: snapshot?.scanner_progress?.message || undefined,
      is_retrying: snapshot?.scanner_progress?.is_retrying,
      ai_thinking: snapshot?.scanner_progress?.ai_thinking,
    }),
    [snapshot?.scanner_progress],
  );

  const plan = useMemo(
    () => ({
      summary: snapshot?.plan_snapshot?.summary || "",
      placement: snapshot?.plan_snapshot?.placement || { new_directory_root: "", review_root: "" },
      items: snapshot?.plan_snapshot?.items || [],
      groups: snapshot?.plan_snapshot?.groups || [],
      target_slots: snapshot?.plan_snapshot?.target_slots || [],
      mappings: snapshot?.plan_snapshot?.mappings || [],
      unresolved_items: snapshot?.plan_snapshot?.unresolved_items || [],
      review_items: snapshot?.plan_snapshot?.review_items || [],
      invalidated_items: snapshot?.plan_snapshot?.invalidated_items || [],
      change_highlights: snapshot?.plan_snapshot?.change_highlights || [],
      stats: snapshot?.plan_snapshot?.stats || {
        directory_count: 0,
        move_count: 0,
        unresolved_count: 0,
      },
      readiness: snapshot?.plan_snapshot?.readiness || { can_precheck: false },
    }),
    [snapshot?.plan_snapshot],
  );



  const precheck = snapshot?.precheck_summary ?? null;
  const incrementalSelection = snapshot?.incremental_selection ?? null;
  const stageView = useMemo(() => getSessionStageView(stage), [stage]);
  const isEmptyCompleted = Boolean(stageView.isCompleted && snapshot?.integrity_flags?.empty_scan_result);
  const isBusy = stageView.isBusyStage || loading;
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const isPlanSyncing = plannerStatus.isRunning;
  const canRunPrecheck = deriveCanRunPrecheck(stage, plan.readiness, isPlanSyncing) && pendingReviewCount === 0;
  const stablePlanReady = hasStablePlan(snapshot);
  const expectedView = snapshot ? getWorkspaceViewForSnapshot(snapshot) : view;
  const isRouteSettling = Boolean(snapshot && expectedView !== view);
  const progressPercent = scanner.total_count > 0 ? (scanner.processed_count / scanner.total_count) * 100 : 0;
  const isHiddenInitialAutoPlanning = Boolean(
    stageView.isPlanningConversation &&
    plannerStatus.isRunning &&
    scanner.status !== "idle" &&
    scanner.total_count > 0 &&
    !snapshot?.assistant_message &&
    Number(snapshot?.plan_snapshot?.stats?.move_count || 0) === 0,
  );
  const initialAutoPlanHasResult = Boolean(
    snapshot?.assistant_message ||
    Number(snapshot?.plan_snapshot?.stats?.move_count || 0) > 0 ||
    Number(snapshot?.plan_snapshot?.stats?.unresolved_count || 0) > 0 ||
    Number(snapshot?.plan_snapshot?.stats?.directory_count || 0) > 0
  );
  const isCompletedScanWaitingForInitialPlan = Boolean(
    stageView.isPlanningConversation &&
    scanner.status === "completed" &&
    scanner.total_count > 0 &&
    !plannerStatus.isRunning &&
    !initialAutoPlanHasResult,
  );
  const isScanCompletionGraceRender = Boolean(
    isCompletedScanWaitingForInitialPlan &&
    previousScannerStatusRef.current === "running",
  );
  const isInitialAutoPlanGraceActive = Boolean(
    isCompletedScanWaitingForInitialPlan &&
    (scanPreviewHoldUntil !== null || isScanCompletionGraceRender),
  );
  const hasStrandedInitialAutoPlan = Boolean(
    isCompletedScanWaitingForInitialPlan &&
    !isInitialAutoPlanGraceActive,
  );
  const isInitialAutoPlanLikelyPending = Boolean(
    stageView.isPlanningConversation &&
    !initialAutoPlanHasResult &&
    !hasStrandedInitialAutoPlan &&
    scanner.total_count > 0 &&
    scanner.status !== "idle" &&
    initialAutoPlanUiState !== "done",
  );
  const canHoldInitialAutoPlanUi = !stageView.isRecovery && !stageView.isInactive && !stageView.isCompleted && !stageView.isReadyToExecute;
  const shouldHoldInitialAutoPlanUi = canHoldInitialAutoPlanUi && !hasStrandedInitialAutoPlan && (
    initialAutoPlanUiState === "pending" || isHiddenInitialAutoPlanning || isInitialAutoPlanLikelyPending
  );
  const progressPhase: WorkspaceProgressPhase = hasStrandedInitialAutoPlan
    ? "stranded"
    : isInitialAutoPlanGraceActive || isHiddenInitialAutoPlanning || (
        stageView.isPlanningConversation &&
        plannerStatus.isRunning &&
        scanner.status === "completed" &&
        !initialAutoPlanHasResult
      )
      ? "planning"
      : stageView.isScanning && scanner.total_count <= 0
        ? "discovering"
        : stageView.isScanning
          ? "analyzing"
          : initialAutoPlanHasResult
            ? "ready"
            : "analyzing";
  const showConversationPane = !isCompactLayout || compactConversationOpen;
  const showPreviewPane = !isCompactLayout || !compactConversationOpen;
  const effectiveComposerMode = isReadOnly ? "hidden" : composerMode;
  const targetPath = snapshot?.target_dir || dirParam || "";
  const targetDirName = useMemo(
    () => formatDirName(targetPath),
    [targetPath],
  );
  const reviewMoveCount = useMemo(
    () => (precheck?.move_preview || []).filter((move) => move.target.split(/[\\/]/).some((part) => part.toLowerCase() === "review")).length,
    [precheck],
  );
  const interruptedDuring = String(snapshot?.integrity_flags?.interrupted_during || "").trim().toLowerCase();
  const isInterruptedDuringScan = stageView.isInterrupted && interruptedDuring === "scanning";
  const precheckItemNames = useMemo(() => {
    const itemNameById = new Map((snapshot?.plan_snapshot?.items || []).map((item) => [item.item_id, item.display_name] as const));
    return (precheck?.move_preview || []).map((move) => itemNameById.get(move.item_id) || displayNameFromPath(move.source));
  }, [precheck?.move_preview, snapshot?.plan_snapshot?.items]);
  const precheckItemsSummary = useMemo(() => summarizeItemNames(precheckItemNames), [precheckItemNames]);
  const nextStepHint = useMemo(() => {
    if (isReadOnly && !stageView.isCompleted) {
      return "当前只能查看记录；如需继续整理，请返回首页重新打开任务。";
    }
    if (stageView.isDraftLike) {
      return "下一步先读取目录，确认这次要整理的项目。";
    }
    if (stageView.isScanning) {
      return "正在只读分析文件。文件较多时可能需要几分钟，可以先最小化，完成后会通知你。";
    }
    if (stageView.isTargetSelection) {
      return "先选择可归入的目标目录，剩余项目会作为本次待整理对象。";
    }
    if (stageView.isPlanning) {
      if (hasStrandedInitialAutoPlan) {
        return "目录读取已完成，但自动方案没有继续生成。可以发送一句整理要求继续规划，或重新扫描。";
      }
      if (progressPhase === "planning") {
        return "目录读取已完成，正在生成第一版整理方案；文件较多时可以先最小化等待通知。";
      }
      return isPlanSyncing ? "正在按你的要求更新方案；文件较多时可以先最小化等待通知。" : "可以继续调整要求，确认后再做移动前检查。";
    }
    if (stageView.isAwaitingPrecheck) {
      return canRunPrecheck ? "方案已就绪，建议先做一次移动前安全检查。" : "方案还在更新，完成后即可检查。";
    }
    if (stageView.isReadyToExecute) {
      return `安全检查通过，待移动 ${precheck?.move_preview.length ?? 0} 项${reviewMoveCount > 0 ? `，其中 ${reviewMoveCount} 项会留在待确认区` : ""}。`;
    }
    if (stageView.isExecuting) {
      return "正在移动文件，请稍后...";
    }
    if (stageView.isCompleted) {
      if (isEmptyCompleted) {
        return "当前目录为空，本次没有需要整理的内容。";
      }
      return "整理已完成。你可以查看结果、处理失败项或清理空目录。";
    }
    if (stageView.isRecovery) {
      return "建议先重新扫描，确认目录状态后再继续整理。";
    }
    return "当前任务正在推进。";
  }, [canRunPrecheck, hasStrandedInitialAutoPlan, isEmptyCompleted, isReadOnly, precheck?.move_preview.length, progressPhase, reviewMoveCount, stageView]);
  const isRootTarget = useMemo(() => /^[a-zA-Z]:[\\/]?$/.test((snapshot?.target_dir || "").trim()), [snapshot?.target_dir]);
  const beginScanPreviewHold = React.useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (scanPreviewTimerRef.current !== null) {
      window.clearTimeout(scanPreviewTimerRef.current);
      scanPreviewTimerRef.current = null;
    }
    setScanPreviewHoldUntil(Date.now() + SCAN_PREVIEW_GRACE_MS);
  }, []);
  const shouldShowScanningPreview = !stageView.isRecovery && !stageView.isInactive && (
    stageView.isScanning || shouldHoldInitialAutoPlanUi || isInitialAutoPlanGraceActive
  );

  const handleMouseMove = React.useCallback((event: MouseEvent) => {
    if (!isResizing.current) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const minLeft = Math.max(380, rect.width * 0.2);
    const maxLeft = Math.min(rect.width - 420, rect.width * 0.7);
    const finalMaxLeft = Math.max(minLeft, maxLeft);
    const boundedX = Math.min(Math.max(event.clientX - rect.left, minLeft), finalMaxLeft);
    const newWidth = (boundedX / rect.width) * 100;

    if (leftPaneRef.current && rightPaneRef.current) {
      leftPaneRef.current.style.width = `${newWidth}%`;
      rightPaneRef.current.style.width = `${100 - newWidth}%`;
    }
    
    if (dividerRef.current) {
      dividerRef.current.style.left = `${boundedX - 1.25}px`;
    }
    
    draggedWidthRef.current = newWidth;
  }, []);

  const stopResizing = React.useCallback(() => {
    isResizing.current = false;
    setIsResizingState(false);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", stopResizing);
    document.body.style.cursor = "default";
    document.body.style.userSelect = "";
    document.body.style.webkitUserSelect = "";
    const finalWidth = draggedWidthRef.current;
    setLeftWidth(finalWidth);
    saveWidth(finalWidth);
  }, [handleMouseMove, saveWidth]);

  const handleStartResizing = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    isResizing.current = true;
    setIsResizingState(true);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", stopResizing);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
  };

  const handleSendMessage = async () => {
    if (isReadOnly || !messageInput.trim() || isBusy || isComposerLocked) {
      return;
    }
    void requestWorkspaceNotificationPermission();
    const content = messageInput;
    setMessageInput("");
    setInitialAutoPlanUiState("done");
    setInitialAutoPlanRevealMessageId(null);
    await sendMessage(content);
  };

  const handleExitWorkbench = () => {
    setShowExitMenu(false);
    if (isReadOnly) {
      if (typeof window !== "undefined" && sessionIdParam) {
        const storedRoute = window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY);
        if (getSessionIdFromWorkspaceRoute(storedRoute) === sessionIdParam) {
          window.localStorage.removeItem(ACTIVE_WORKSPACE_ROUTE_KEY);
          window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
        }
      }
      router.push("/");
      return;
    }
    setExitConfirmOpen(true);
  };

  const handleConfirmExitWorkbench = async () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ACTIVE_WORKSPACE_ROUTE_KEY);
      window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
    }
    setExitConfirmOpen(false);
    router.push("/");
  };

  const handleConfirmAbortScan = async () => {
    setScanAborting(true);
    try {
      const success = await abandonSession();
      if (success) {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(ACTIVE_WORKSPACE_ROUTE_KEY);
          window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
        }
        setScanAbortConfirmOpen(false);
        router.push("/");
      }
    } finally {
      setScanAborting(false);
    }
  };
  const handleStartScan = React.useCallback(() => {
    void requestWorkspaceNotificationPermission();
    beginScanPreviewHold();
    void scan();
  }, [beginScanPreviewHold, scan]);

  const handleOpenConversation = React.useCallback(() => {
    setInitialAutoPlanUiState("done");
    setInitialAutoPlanRevealMessageId(null);
    setIsChatCollapsed(false);
    setCompactConversationOpen(true);
  }, []);

  const handleCloseConversation = React.useCallback(() => {
    setIsChatCollapsed(true);
    setCompactConversationOpen(false);
  }, []);

  const handleToggleCompactConversation = React.useCallback(() => {
    setCompactConversationOpen((current) => {
      const next = !current;
      if (next) {
        setInitialAutoPlanUiState("done");
        setInitialAutoPlanRevealMessageId(null);
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!autoStartScan || isReadOnly || !sessionIdParam || !snapshot || loading) {
      return;
    }
    if (autoScanRequestedRef.current) {
      return;
    }
    if (!stageView.isDraftLike) {
      return;
    }
    autoScanRequestedRef.current = true;
    handleStartScan();
  }, [autoStartScan, handleStartScan, isReadOnly, loading, sessionIdParam, snapshot, stageView.isDraftLike]);

  React.useEffect(() => {
    if (!snapshot || !sessionIdParam) {
      return;
    }
    const nextRoute = getWorkspaceRouteForSnapshot(snapshot, {
      dir: dirParam,
      readonly: isReadOnly,
    });

    if (typeof window !== "undefined") {
      const isCompleted = stageView.isCompleted;
      const isInactive = stageView.isInactive;
      const shouldClear = isReadOnly || isCompleted || isInactive;

      if (shouldClear) {
        const storedRoute = window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY);
        if (getSessionIdFromWorkspaceRoute(storedRoute) === sessionIdParam) {
          window.localStorage.removeItem(ACTIVE_WORKSPACE_ROUTE_KEY);
          window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
        }
      } else {
        const storedRoute = window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY);
        if (storedRoute !== nextRoute) {
          window.localStorage.setItem(ACTIVE_WORKSPACE_ROUTE_KEY, nextRoute);
          window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
        }
      }
    }

    if (!nextRoute.startsWith(`/workspace/${view}`)) {
      if (lastNavigatedRouteRef.current !== nextRoute) {
        lastNavigatedRouteRef.current = nextRoute;
        router.replace(nextRoute);
      }
    } else {
      lastNavigatedRouteRef.current = null;
    }
  }, [dirParam, isReadOnly, router, sessionIdParam, snapshot, view, stageView.isCompleted, stageView.isInactive]);

  React.useEffect(() => {
    taskNotificationRef.current = {
      initialized: false,
      wasScanning: false,
      wasPlanning: false,
      lastPlanStartedAt: null,
    };
  }, [sessionIdParam]);

  React.useEffect(() => {
    if (!snapshot || !sessionIdParam) {
      return;
    }

    const current = taskNotificationRef.current;
    const isScanningNow = stageView.isScanning;
    const isPlanningNow = plannerStatus.isRunning;
    const planStartedAt = snapshot.planner_progress?.started_at || null;

    if (!current.initialized) {
      taskNotificationRef.current = {
        initialized: true,
        wasScanning: isScanningNow,
        wasPlanning: isPlanningNow,
        lastPlanStartedAt: planStartedAt,
      };
      return;
    }

    if (current.wasScanning && !isScanningNow && isPlanningNow) {
      const totalCount = Number(snapshot.scanner_progress?.total_count || 0);
      const processedCount = Number(snapshot.scanner_progress?.processed_count || 0);
      const countLabel = totalCount > 0 ? `已读取 ${processedCount || totalCount}/${totalCount} 项。` : "已完成目录读取。";
      notifyWorkspaceWhenAway(
        "FilePilot 正在生成方案",
        `${countLabel}正在生成第一版整理建议。`,
        `filepilot-scan-planning-${sessionIdParam}`,
      );
    }

    if (current.wasScanning && !isScanningNow && !isPlanningNow) {
      const totalCount = Number(snapshot.scanner_progress?.total_count || 0);
      const processedCount = Number(snapshot.scanner_progress?.processed_count || 0);
      const countLabel = totalCount > 0 ? `已读取 ${processedCount || totalCount}/${totalCount} 项。` : "已完成目录读取。";
      notifyWorkspaceWhenAway(
        "FilePilot 方案已准备好",
        `${countLabel}可以回到工作台查看整理建议。`,
        `filepilot-scan-${sessionIdParam}`,
      );
    }

    if (current.wasPlanning && !isPlanningNow && current.lastPlanStartedAt && !current.wasScanning) {
      const moveCount = Number(snapshot.plan_snapshot?.stats?.move_count || 0);
      const unresolvedCount = Number(snapshot.plan_snapshot?.stats?.unresolved_count || 0);
      const detail = unresolvedCount > 0
        ? `方案已更新，仍有 ${unresolvedCount} 项需要确认。`
        : `方案已更新，已规划 ${moveCount} 项，可以进行移动风险检查。`;
      notifyWorkspaceWhenAway(
        "FilePilot 方案已更新",
        detail,
        `filepilot-plan-${sessionIdParam}-${current.lastPlanStartedAt}`,
      );
    }

    taskNotificationRef.current = {
      initialized: true,
      wasScanning: isScanningNow,
      wasPlanning: isPlanningNow,
      lastPlanStartedAt: planStartedAt,
    };
  }, [
    plannerStatus.isRunning,
    sessionIdParam,
    snapshot,
    stageView.isScanning,
  ]);

  const statusNotice = useMemo<ConversationNotice | null>(() => {
    if (streamStatus === "offline") {
      return {
        tone: "warning",
        title: "实时连接已断开",
        description: stageView.isCompleted
          ? "页面会保留已经收到的记录和结果。你可以先查看右侧结果，或重新连接获取最新状态。"
          : "页面仍可查看已经收到的内容。重新连接后，会继续接收当前任务的更新。",
        primaryAction: {
          label: "重新连接",
          onClick: () => {
            void retryStream();
          },
        },
      };
    }

    if (isReadOnly && !stageView.isCompleted) {
      return {
        tone: "warning",
        title: "当前只能查看",
        description: "这里保留之前的方案和记录，不能修改或执行。如需继续整理，请返回首页重新打开任务。",
      };
    }

    if (canRunPrecheck) {
      return null;
    }

    if (stageView.isReadyToExecute) {
      return null;
    }

    if (hasStrandedInitialAutoPlan) {
      return {
        tone: "warning",
        title: "目录读取已完成",
        description: "自动方案没有继续生成。可以在下方发送一句整理要求继续规划，或重新扫描。",
        primaryAction: {
          label: "重新扫描",
          onClick: handleStartScan,
        },
      };
    }

    if (stageView.isStale) {
      return {
        tone: "warning",
        title: "目录内容已变化",
        description: "当前方案可能不再准确。建议重新扫描后再继续整理。",
        primaryAction: {
          label: "重新扫描",
          onClick: handleStartScan,
        },
        secondaryAction: {
          label: "结束本次任务",
          onClick: handleExitWorkbench,
        },
      };
    }

    if (stageView.isInterrupted) {
      return {
        tone: "danger",
        title: "任务已中断",
        description: snapshot?.last_error ? localizeSessionLastError(snapshot.last_error) : "建议重新扫描一次，确认目录状态后再继续。",
        primaryAction: {
          label: "重新扫描",
          onClick: handleStartScan,
        },
        secondaryAction: {
          label: "结束本次任务",
          onClick: handleExitWorkbench,
        },
      };
    }

    if (stageView.isCompleted) {
      if (isEmptyCompleted) {
        return {
          tone: "info",
          title: isReadOnly ? "这是之前的空任务记录" : "当前目录为空",
          description: isReadOnly
            ? "这次任务没有发现需要整理的内容，记录会保留为只读。"
            : "这次任务没有发现需要整理的内容。你可以返回首页，或在目录更新后重新扫描并重建方案。",
        };
      }
      return {
        tone: "info",
        title: isReadOnly ? "这是之前的整理结果" : "整理完成",
        description: isReadOnly
          ? "左侧保留了当时的记录，输入已关闭；右侧可以继续查看这次整理结果。"
          : "左侧保留本轮记录供回看，输入已关闭；请在右侧查看结果、失败项和待确认区。",
      };
    }

    return null;
  }, [canRunPrecheck, handleStartScan, hasStrandedInitialAutoPlan, isEmptyCompleted, isReadOnly, precheck?.move_preview.length, precheckItemsSummary, retryStream, snapshot?.last_error, stageView, streamStatus]);

  const workspacePrimaryNotice = useMemo<WorkspacePrimaryNotice>(() => {
    const baseNotice: ConversationNotice = statusNotice ?? {
      tone: stageView.isCompleted ? "info" : stageView.isReadyToExecute ? "warning" : "info",
      title: stageView.isDraftLike
        ? "等待开始读取目录"
        : stageView.isReadyToExecute
          ? "安全检查已通过"
          : stageView.isExecuting
            ? "正在执行整理"
            : stageView.isCompleted
              ? isEmptyCompleted
                ? "本次没有需要整理的内容"
                : "整理已完成"
              : canRunPrecheck
                ? "方案已准备好检查"
                : getFriendlyStage(stage),
      description: nextStepHint,
      primaryAction: stageView.isDraftLike && !isReadOnly
        ? {
            label: "开始读取目录",
            onClick: handleStartScan,
          }
        : canRunPrecheck && !isReadOnly
          ? {
              label: "检查移动风险",
              onClick: () => {
                void runPrecheck();
              },
            }
          : undefined,
    };

    return {
      ...baseNotice,
      stageLabel: getFriendlyStage(stage),
      steps: deriveWorkspacePipeline(stageView, progressPhase),
    };
  }, [canRunPrecheck, handleStartScan, isEmptyCompleted, isReadOnly, nextStepHint, progressPhase, runPrecheck, stage, stageView, statusNotice]);

  const conversationNotice = isCompactLayout && compactConversationOpen ? statusNotice : null;

  React.useEffect(() => {
    if (view !== "plan") {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey || e.altKey) && e.key === "b") {
        e.preventDefault();
        setIsChatCollapsed((prev) => {
          const next = !prev;
          if (!next) {
            setInitialAutoPlanUiState("done");
            setInitialAutoPlanRevealMessageId(null);
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view]);

  React.useEffect(() => {
    if (isCompletedScanWaitingForInitialPlan && previousScannerStatusRef.current === "running") {
      setScanPreviewHoldUntil(Date.now() + SCAN_PREVIEW_GRACE_MS);
    }
    previousScannerStatusRef.current = String(scanner.status || "idle");
  }, [isCompletedScanWaitingForInitialPlan, scanner.status]);

  React.useEffect(() => {
    if (stageView.isScanning) {
      beginScanPreviewHold();
    }
  }, [beginScanPreviewHold, stageView]);

  React.useEffect(() => {
    if (stageView.isRecovery || stageView.isInactive || stageView.isCompleted || stageView.isReadyToExecute) {
      if (initialAutoPlanUiState !== "idle") {
        setInitialAutoPlanUiState("idle");
        setInitialAutoPlanRevealMessageId(null);
      }
      setScanPreviewHoldUntil(null);
      return;
    }

    if (stageView.isPlanningConversation && plannerStatus.isRunning) {
      return;
    }

    const shouldEnterInitialAutoPlan = (
      stageView.isScanning &&
      scanner.total_count > 0 &&
      !initialAutoPlanHasResult
    ) || isInitialAutoPlanLikelyPending || isHiddenInitialAutoPlanning;

    if (shouldEnterInitialAutoPlan) {
      if (initialAutoPlanUiState !== "pending") {
        setInitialAutoPlanUiState("pending");
        setInitialAutoPlanRevealMessageId(null);
      }
      return;
    }

    if (hasStrandedInitialAutoPlan && initialAutoPlanUiState === "pending") {
      setInitialAutoPlanUiState("done");
      setInitialAutoPlanRevealMessageId(null);
      return;
    }

    if (
      stageView.isPlanningConversation &&
      initialAutoPlanUiState === "pending" &&
      !hasStrandedInitialAutoPlan &&
      !plannerStatus.isRunning &&
      initialAutoPlanHasResult
    ) {
      setInitialAutoPlanUiState("done");
      setInitialAutoPlanRevealMessageId(null);
    }
  }, [
    initialAutoPlanHasResult,
    initialAutoPlanUiState,
    hasStrandedInitialAutoPlan,
    isInitialAutoPlanLikelyPending,
    isHiddenInitialAutoPlanning,
    plannerStatus.isRunning,
    scanner.status,
    scanner.total_count,
    stageView,
  ]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (scanPreviewTimerRef.current !== null) {
      window.clearTimeout(scanPreviewTimerRef.current);
      scanPreviewTimerRef.current = null;
    }
    if (scanPreviewHoldUntil === null) {
      return;
    }
    if (shouldShowScanningPreview) {
      const remaining = Math.max(0, scanPreviewHoldUntil - Date.now());
      if (remaining > 0) {
        scanPreviewTimerRef.current = window.setTimeout(() => {
          setScanPreviewHoldUntil(null);
          scanPreviewTimerRef.current = null;
        }, remaining);
        return () => {
          if (scanPreviewTimerRef.current !== null) {
            window.clearTimeout(scanPreviewTimerRef.current);
            scanPreviewTimerRef.current = null;
          }
        };
      }
    }
    setScanPreviewHoldUntil(null);
  }, [scanPreviewHoldUntil, shouldShowScanningPreview]);

  React.useEffect(() => {
    if (stageView.isCompleted && !isEmptyCompleted && !journal && !journalLoading && !isBusy) {
      void loadJournal();
    }
  }, [stageView, isEmptyCompleted, journal, journalLoading, isBusy, loadJournal]);

  React.useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && scanPreviewTimerRef.current !== null) {
        window.clearTimeout(scanPreviewTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!showConversationPane || isCompactLayout) {
      setDividerLeft(null);
      return;
    }

    const container = containerRef.current;
    const leftPane = leftPaneRef.current;
    if (!container || !leftPane) {
      return;
    }

    const updateDivider = () => {
      if (isResizing.current) return;
      setDividerLeft(leftPane.getBoundingClientRect().width);
    };

    updateDivider();
    const observer = new ResizeObserver(() => {
      updateDivider();
    });
    observer.observe(container);
    observer.observe(leftPane);
    return () => {
      observer.disconnect();
    };
  }, [isCompactLayout, showConversationPane, leftWidth]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const targetPath = snapshot?.target_dir || dirParam || "";
    const hasTargetPath = Boolean(targetPath);
    const dirName = snapshot?.session_title || formatDirName(targetPath);
    window.localStorage.setItem(
      WORKSPACE_CONTEXT_KEY,
      JSON.stringify({
        dirName,
        stage: getFriendlyStage(stage),
        sessionId: sessionIdParam || undefined,
        hasTargetPath,
      }),
    );
    window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
  }, [APP_CONTEXT_EVENT, WORKSPACE_CONTEXT_KEY, dirParam, sessionIdParam, snapshot?.target_dir, snapshot?.session_title, stage]);

  React.useEffect(() => {
    if (view !== "plan") {
      return;
    }
    const shouldKeepConversationCollapsed =
      stageView.isScanning ||
      stageView.isReadyToExecute ||
      stageView.isCompleted ||
      (stageView.isPlanningConversation && (
        shouldHoldInitialAutoPlanUi ||
        initialAutoPlanUiState === "pending" ||
        !initialAutoPlanHasResult
      ));
    const shouldOpenConversation =
      stageView.isDraftLike ||
      stageView.isTargetSelection ||
      stageView.isRecovery ||
      hasStrandedInitialAutoPlan ||
      (
        stageView.isPlanningConversation &&
        initialAutoPlanUiState === "done" &&
        initialAutoPlanHasResult &&
        !plannerStatus.isRunning &&
        !shouldHoldInitialAutoPlanUi
      );

    if (shouldKeepConversationCollapsed) {
      setIsChatCollapsed(true);
      setCompactConversationOpen(false);
    } else if (shouldOpenConversation) {
      setIsChatCollapsed(false);
    }
  }, [
    initialAutoPlanHasResult,
    initialAutoPlanUiState,
    hasStrandedInitialAutoPlan,
    shouldHoldInitialAutoPlanUi,
    stageView,
    stageView.isScanning,
    stageView.isCompleted,
    stageView.isReadyToExecute,
    plannerStatus.isRunning,
    view,
  ]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !sessionIdParam) {
      return;
    }
    const canRememberWorkspaceRoute = !isReadOnly && !stageView.isCompleted;
    if (canRememberWorkspaceRoute) {
      const params = new URLSearchParams(window.location.search);
      params.delete("auto_scan");
      const query = params.toString();
      window.localStorage.setItem(ACTIVE_WORKSPACE_ROUTE_KEY, query ? `/workspace/${view}?${query}` : `/workspace/${view}`);
      window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
      return;
    }
    const storedRoute = window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY);
    if (getSessionIdFromWorkspaceRoute(storedRoute) === sessionIdParam) {
      window.localStorage.removeItem(ACTIVE_WORKSPACE_ROUTE_KEY);
      window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
    }
  }, [ACTIVE_WORKSPACE_ROUTE_KEY, APP_CONTEXT_EVENT, isReadOnly, sessionIdParam, stageView.isCompleted, view]);

  const focusPreviewItems = React.useCallback((itemIds: string[], filter?: PreviewFilter) => {
    setPreviewFocusRequest({
      token: Date.now(),
      itemIds,
      filter,
    });
  }, []);

  const handlePrepareRollback = async () => {
    if (isReadOnly) {
      return;
    }
    const precheck = await prepareRollback();
    if (precheck) {
      setRollbackPrecheck(precheck);
      setRollbackConfirmOpen(true);
    }
  };

  const handleConfirmRollback = async () => {
    const ok = await confirmRollback();
    if (ok) {
      setRollbackConfirmOpen(false);
      setRollbackPrecheck(null);
    }
  };

  const handleCancelRollback = () => {
    if (loading) {
      return;
    }
    setRollbackConfirmOpen(false);
    setRollbackPrecheck(null);
  };

  const renderWorkspaceStatusStrip = () => {
    if (shouldShowScanningPreview) {
      return null;
    }
    const notice = workspacePrimaryNotice;
    const toneClass =
      notice.tone === "danger"
        ? "border-error/20 bg-error/[0.035]"
        : notice.tone === "warning"
          ? "border-warning/20 bg-warning-container/8"
          : "border-primary/12 bg-surface-container-lowest";
    const iconClass =
      notice.tone === "danger"
        ? "bg-error/10 text-error"
        : notice.tone === "warning"
          ? "bg-warning/12 text-warning"
          : "bg-primary/8 text-primary";

    return (
      <div className={cn("z-10 border-b px-4 py-3", toneClass)}>
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-[260px] flex-1 items-center gap-3">
            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]", iconClass)}>
              {notice.tone === "danger" ? <AlertCircle className="h-4 w-4" /> : notice.tone === "warning" ? <AlertTriangle className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-on-surface/[0.05] px-2 py-0.5 text-[10px] font-black text-on-surface/45">
                  {notice.stageLabel}
                </span>
                <p className="text-[13px] font-black text-on-surface">{notice.title}</p>
              </div>
              <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-5 text-on-surface-variant/70">{notice.description}</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="hidden items-center gap-1.5 xl:flex">
              {notice.steps.map((step, index) => (
                <React.Fragment key={step.id}>
                  <div
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-black",
                      step.state === "done"
                        ? "border-success/15 bg-success/8 text-success-dim"
                        : step.state === "active"
                          ? "border-primary/18 bg-primary/8 text-primary"
                          : step.state === "blocked"
                            ? "border-warning/18 bg-warning-container/10 text-warning"
                            : "border-on-surface/8 bg-on-surface/[0.025] text-on-surface/32",
                    )}
                  >
                    {step.state === "done" ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : step.state === "active" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : step.state === "blocked" ? (
                      <ShieldAlert className="h-3 w-3" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-35" />
                    )}
                    {step.label}
                  </div>
                  {index < notice.steps.length - 1 ? <ArrowRight className="h-3 w-3 text-on-surface/18" /> : null}
                </React.Fragment>
              ))}
            </div>
            {notice.secondaryAction ? (
              <button
                type="button"
                onClick={notice.secondaryAction.onClick}
                className="rounded-[7px] border border-on-surface/10 bg-surface px-3 py-1.5 text-[11px] font-bold text-on-surface-variant transition-colors hover:bg-on-surface/5"
              >
                {notice.secondaryAction.label}
              </button>
            ) : null}
            {notice.primaryAction ? (
              <button
                type="button"
                onClick={notice.primaryAction.onClick}
                className="rounded-[7px] bg-primary px-3 py-1.5 text-[11px] font-black text-white transition-opacity hover:opacity-90"
              >
                {notice.primaryAction.label}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderPreviewContent = () => (
    <ErrorBoundary fallbackTitle="预览区加载失败">
        <div className="h-full w-full">
          {(() => {
            if (view === "progress") {
              if (stageView.isDraftLike) {
                return (
                  <EmptyState
                    illustration={FileRadarIllustration}
                    title="等待读取目录"
                    description="开始后会先只读扫描目录，再生成第一版整理方案。"
                    className="mx-auto h-[70vh] max-w-[1360px]"
                  />
                );
              }
              if (stageView.isRecovery || stageView.isInactive) {
                return (
                  <EmptyState
                    icon={AlertTriangle}
                    title="正在打开恢复页"
                    description="这次任务需要恢复处理，稍后会自动切换到恢复入口。"
                    className="mx-auto h-full max-w-[1360px]"
                  />
                );
              }
              if (stageView.isCompleted || stageView.isReadyToExecute || initialAutoPlanHasResult) {
                return (
                  <div className="flex h-full w-full flex-col items-center justify-center p-8 animate-in fade-in zoom-in-95 duration-500">
                    <div className="relative flex flex-col items-center gap-6">
                      <div className="relative flex h-16 w-16 items-center justify-center rounded-[20px] bg-primary/[0.04] text-primary">
                        <div className="absolute inset-0 rounded-[20px] border border-primary/10" />
                        <div className="absolute inset-0 rounded-[20px] bg-primary/10 animate-ping opacity-20" style={{ animationDuration: '3s' }} />
                        <CheckCircle2 className="h-7 w-7 stroke-[2.5]" />
                      </div>

                      <div className="flex flex-col items-center gap-2 text-center">
                        <h3 className="text-[17px] font-black tracking-tight text-on-surface">
                          方案已准备好
                        </h3>
                        <p className="flex items-center gap-2 text-[13px] font-medium text-on-surface-variant/70">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/70" />
                          <span>正在打开方案工作区...</span>
                        </p>
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <MinimalScanningView
                  scanner={scanner}
                  progressPercent={progressPercent}
                  phase={progressPhase === "stranded" ? "planning" : progressPhase}
                  onAbort={progressPhase === "planning" ? undefined : () => setScanAbortConfirmOpen(true)}
                  aborting={scanAborting}
                  isModelConfigured={isTextModelConfigured}
                />
              );
            }

            if (view === "plan" && stageView.isPlanningConversation && !stablePlanReady) {
              return (
                <MinimalScanningView
                  scanner={scanner}
                  progressPercent={progressPercent}
                  phase="planning"
                  aborting={scanAborting}
                  isModelConfigured={isTextModelConfigured}
                />
              );
            }

            if (shouldShowScanningPreview) {
              return (
                <MinimalScanningView
                  scanner={scanner}
                  progressPercent={progressPercent}
                  phase={progressPhase}
                  onAbort={progressPhase === "planning" ? undefined : () => setScanAbortConfirmOpen(true)}
                  aborting={scanAborting}
                  isModelConfigured={isTextModelConfigured}
                />
              );
            }

            if (stageView.isExecuting || stageView.isRollingBack) {
              return (
                <EmptyState
                  icon={Loader2}
                  title={stageView.isRollingBack ? "正在回退整理" : "正在执行整理"}
                  description={stageView.isRollingBack ? "正在按回退记录恢复文件位置，请不要关闭窗口。" : "正在移动本地文件，完成后会自动打开整理结果。"}
                  className="mx-auto h-full max-w-[1360px]"
                />
              );
            }

            if (stageView.isCompleted) {
              if (isEmptyCompleted) {
                return (
                  <EmptyState
                    illustration={FileRadarIllustration}
                    title="当前目录为空"
                    description="这次扫描没有发现需要整理的内容。你可以返回首页，或在目录内容更新后重新扫描并重建方案。"
                    className="mx-auto h-full max-w-[1360px]"
                  >
                    <div className="flex items-center justify-center gap-3">
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={handleStartScan}
                          className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-4 py-2 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          重新扫描
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleExitWorkbench}
                        className="rounded-[8px] border border-on-surface/10 bg-surface px-4 py-2 text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-on-surface/5"
                      >
                        返回首页
                      </button>
                    </div>
                  </EmptyState>
                );
              }
              return (
                <CompletionView
                  journal={journal}
                  summary={snapshot?.summary || ""}
                  loading={journalLoading || !journal}
                  targetDir={snapshot?.target_dir || ""}
                  organizeMethod={snapshot?.strategy?.organize_method}
                  cleanupCandidateCount={snapshot?.execution_report?.cleanup_candidate_count ?? 0}
                  isBusy={isBusy}
                  readOnly={isReadOnly}
                  onOpenExplorer={(path) => void openExplorer(path || snapshot?.target_dir || "")}
                  onCleanupDirs={() => {
                    if (!isReadOnly) void cleanupEmptyDirs();
                  }}
                  onRollback={() => {
                    if (!isReadOnly) void handlePrepareRollback();
                  }}
                  onGoHome={handleExitWorkbench}
                />
              );
            }

            if (stageView.isReadyToExecute) {
              return (
                <PrecheckView
                  summary={snapshot?.precheck_summary || null}
                  planItems={snapshot?.plan_snapshot?.items || []}
                  targetSlots={snapshot?.plan_snapshot?.target_slots || []}
                  isBusy={isBusy}
                  readOnly={isReadOnly}
                  onRequestExecute={() => {
                    if (!isReadOnly) {
                      setExecuteConfirmOpen(true);
                    }
                  }}
                  onBack={() => {
                    if (!isReadOnly) void returnToPlanning();
                  }}
                  onLocateIssue={(itemIds, filter) => {
                    if (isReadOnly) return;
                    void (async () => {
                      await returnToPlanning();
                      focusPreviewItems(itemIds, filter as PreviewFilter | undefined);
                    })();
                  }}
                />
              );
            }

            if (stageView.isDraftLike) {
              return (
                <EmptyState
                  illustration={FileRadarIllustration}
                  title="等待读取目录"
                  description="开始后会先只读扫描目录，再在这里显示整理建议。"
                  className="mx-auto h-[70vh] max-w-[1360px]"
                />
              );
            }

            if (stageView.isTargetSelection) {
              return (
                <IncrementalSelectionView
                  rootDirectoryOptions={incrementalSelection?.root_directory_options || []}
                  sourceTreeEntries={snapshot?.source_tree_entries || []}
                  loading={loading}
                  onConfirm={(selectedTargetDirs) => {
                    if (!isReadOnly) {
                      void requestWorkspaceNotificationPermission();
                      void confirmTargetDirectories(selectedTargetDirs);
                    }
                  }}
                />
              );
            }

            return (
              <div className="flex h-full flex-col">
                <div className="flex-1 overflow-hidden">
                  {isInterruptedDuringScan ? (
                    <EmptyState
                      illustration={FileRadarIllustration}
                      title="扫描中断，尚未形成方案"
                      description="这次任务还没有得到可确认的整理建议。建议先重新扫描，确认目录内容后再继续。"
                      className="mx-auto h-full max-w-[1360px]"
                    >
                      <div className="flex items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={handleStartScan}
                          className="inline-flex items-center gap-1.5 rounded-[8px] bg-warning px-4 py-2 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          重新扫描
                        </button>
                        <button
                          type="button"
                          onClick={handleExitWorkbench}
                          className="rounded-[8px] border border-on-surface/10 bg-surface px-4 py-2 text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-on-surface/5"
                        >
                          结束本次任务
                        </button>
                      </div>
                    </EmptyState>
                  ) : (
                    <PreviewPanel
                      plan={plan}
                      stage={stage}
                      organizeMode={snapshot?.strategy?.organize_mode || "initial"}
                      isBusy={isBusy}
                      isPlanSyncing={isPlanSyncing}
                      plannerStatus={plannerStatus}
                      plannerRunKey={snapshot?.planner_progress?.started_at || null}
                      readOnly={isReadOnly}
                      focusRequest={previewFocusRequest}
                      sourceTreeEntries={snapshot?.source_tree_entries || []}
                      incrementalSelection={incrementalSelection}
                      precheckSummary={snapshot?.precheck_summary}
                      onRunPrecheck={() => {
                        if (!isReadOnly) void runPrecheck();
                      }}
                      onApplyTargetConflictSuggestions={() => {
                        if (!isReadOnly) void applyTargetConflictSuggestions();
                      }}
                      onUpdateItem={async (id, payload) => {
                        if (!isReadOnly) await updateItem({ item_id: id, ...payload });
                      }}
                      onRestoreAiSuggestion={async (id) => {
                        if (!isReadOnly) await restoreAiSuggestion(id);
                      }}
                      onPendingReviewCountChange={setPendingReviewCount}
                    />
                  )}
                </div>
              </div>
            );
          })()}
        </div>
    </ErrorBoundary>
  );

  const renderLayoutSkeleton = () => (
    <div className="flex flex-1 min-h-0 animate-pulse">
      <section
        style={{ width: `${DEFAULT_LEFT_WIDTH}%` }}
        className="flex min-h-0 min-w-[360px] flex-col border-r border-on-surface/7 bg-surface-container-lowest"
      >
        <div className="border-b border-on-surface/6 px-5 py-4">
          <div className="h-5 w-32 rounded bg-surface-container-low" />
          <div className="mt-3 h-3 w-56 rounded bg-surface-container-low" />
        </div>
        <div className="flex-1 space-y-4 px-5 py-5">
          <div className="h-24 rounded-[8px] bg-surface-container-low" />
          <div className="h-24 rounded-[8px] bg-surface-container-low" />
          <div className="h-24 rounded-[8px] bg-surface-container-low" />
        </div>
        <div className="border-t border-on-surface/6 px-5 py-4">
          <div className="h-14 rounded-[8px] bg-surface-container-low" />
        </div>
      </section>
      <section
        style={{ width: `${100 - DEFAULT_LEFT_WIDTH}%` }}
        className="flex min-h-0 min-w-[320px] flex-col bg-surface-container-low/45 p-5"
      >
        <div className="h-28 rounded-[8px] bg-surface-container-low" />
        <div className="mt-4 grid flex-1 gap-4 md:grid-cols-2">
          <div className="rounded-[8px] bg-surface-container-low" />
          <div className="rounded-[8px] bg-surface-container-low" />
        </div>
      </section>
    </div>
  );

  const conversationPanel = (
    <ConversationPanel
      messages={chatMessages}
      assistantDraft={assistantDraft}
      error={chatError}
      composerMode={effectiveComposerMode}
      isBusy={isBusy}
      isComposerLocked={isComposerLocked}
      composerStatus={composerStatus}
      plannerStatus={plannerStatus}
      revealMessageId={initialAutoPlanUiState === "revealing" ? initialAutoPlanRevealMessageId : null}
      stage={stage}
      messageInput={messageInput}
      setMessageInput={setMessageInput}
      onSendMessage={handleSendMessage}
      onStartScan={handleStartScan}
      unresolvedCount={(plan.invalidated_items?.length || 0) + plan.unresolved_items.length + pendingReviewCount}
      canRunPrecheck={canRunPrecheck}
      notice={conversationNotice}
      scanner={scanner}
      progressPercent={progressPercent}
    />
  );

  const conversationHeader = (
    <div className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-on-surface/6 bg-surface/50 px-4 py-1.5 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-full bg-primary/8 px-1.5 py-0.5 text-[10px] font-black text-primary">
          <span className={cn("h-1 w-1 rounded-full", stageView.isCompleted ? "bg-success" : "bg-primary/60")} />
          {getFriendlyStage(stage)}
        </span>

        {assistantRuntime && (
          <span className="flex items-center gap-1 rounded-full bg-on-surface/[0.04] px-1.5 py-0.5 text-[10px] font-bold text-ui-muted">
            <Loader2 className="h-2.5 w-2.5 animate-spin-slow" />
            {assistantRuntime.label}
          </span>
        )}

        {streamStatus !== "connected" && (
          <span className={cn(
            "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest",
            streamStatus === "connecting" || streamStatus === "reconnecting" ? "bg-warning/10 text-warning" : "bg-on-surface/5 text-ui-muted"
          )}>
            {streamStatus === "connecting" ? "连接中" : streamStatus === "reconnecting" ? "重连中" : "离线"}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!isCompactLayout && (
           <button
           type="button"
           onClick={handleCloseConversation}
           className="flex h-6 w-6 items-center justify-center rounded-[4px] text-on-surface/30 transition-all hover:bg-on-surface/10 hover:text-on-surface"
           title="收起聊天区 (Alt+B)"
         >
           <PanelLeftClose className="h-3.5 w-3.5" />
         </button>
        )}
        {!isCompactLayout && (
           <button
            type="button"
            onClick={handleExitWorkbench}
            className="flex h-6 items-center gap-1.5 rounded-[4px] px-2 text-[11px] font-black text-on-surface/40 transition-colors hover:bg-on-surface/5 hover:text-on-surface"
          >
            <LogOut className="h-3 w-3" />
            退出
          </button>
        )}
      </div>
    </div>
  );

  const singlePaneContent = (
    <section className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      {view === "progress" || view === "review" ? null : renderWorkspaceStatusStrip()}
      <div className="flex-1 min-h-0 w-full overflow-hidden flex flex-col">{renderPreviewContent()}</div>
    </section>
  );

  const planWorkbenchContent = (
    <>
      {!isChatCollapsed && (
        <section
          ref={leftPaneRef as any}
          style={{ width: isCompactLayout ? "100%" : `${leftWidth}%` }}
          className={cn(
            "relative flex h-full min-h-0 flex-col bg-surface-container-low overflow-hidden min-w-0 border-r border-on-surface/8",
            isCompactLayout ? "" : "",
          )}
        >
          <div className="flex flex-col h-full min-w-[360px]">
            {conversationHeader}
            {conversationPanel}
          </div>
        </section>
      )}

      {isChatCollapsed && !isCompactLayout && (
        <div className="z-50 flex h-full w-[38px] flex-col items-center bg-surface-container-lowest border-r border-on-surface/8 py-3 gap-6">
          <button
            type="button"
            onClick={handleOpenConversation}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-white transition-all hover:scale-105 active:scale-95"
            title="展开聊天区 (Alt+B)"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
          <div className="h-px w-4 bg-on-surface/[0.08]" />
          <div className="flex-1 flex flex-col items-center justify-center">
            <div
              className="whitespace-nowrap text-[9px] font-black uppercase tracking-[0.3em] text-on-surface/20"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >
              会话记录
            </div>
          </div>
        </div>
      )}

      {showConversationPane && showPreviewPane && !isCompactLayout && !isChatCollapsed && (
        <div
          ref={dividerRef}
          onMouseDown={handleStartResizing}
          className={cn(
            "absolute top-0 bottom-0 w-2.5 z-40 transition-all duration-300 cursor-col-resize flex items-center justify-center select-none group",
            isResizingState ? "bg-primary/[0.02]" : "hover:bg-primary/[0.04]",
          )}
          style={{ left: dividerLeft !== null ? `${dividerLeft - 1.25}px` : `calc(${leftWidth}% - 1.25px)` }}
        >
          <div className={cn("w-[1px] h-full transition-all duration-300", isResizingState ? "bg-primary/20" : "bg-transparent")} />
          <div
            className={cn(
              "absolute top-1/2 flex h-9 w-5 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-[8px] border border-on-surface/12 bg-surface-container-lowest transition-all duration-200",
              isResizingState ? "scale-110 border-primary/20 opacity-100" : "opacity-0 group-hover:opacity-100 scale-100",
            )}
          >
            <div className={cn("w-[1.5px] h-3 rounded-sm transition-colors", isResizingState ? "bg-primary/40" : "bg-on-surface/15")} />
            <div className={cn("w-[1.5px] h-3 rounded-sm transition-colors", isResizingState ? "bg-primary/40" : "bg-on-surface/15")} />
          </div>
        </div>
      )}

      {showPreviewPane && (
        <section
          ref={rightPaneRef as any}
          style={{ width: !isCompactLayout && showConversationPane && !isChatCollapsed ? `${100 - leftWidth}%` : "100%" }}
          className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-surface"
        >
          {renderWorkspaceStatusStrip()}
          <div className="flex-1 min-h-0 w-full overflow-hidden flex flex-col">{renderPreviewContent()}</div>
        </section>
      )}
    </>
  );

  const routeTransitionTitle =
    expectedView === "review"
      ? "正在打开安全检查"
      : expectedView === "plan"
        ? "正在返回方案工作区"
        : expectedView === "result"
          ? "正在打开整理结果"
          : expectedView === "recovery"
            ? "正在打开恢复入口"
            : "正在切换工作区";

  const routeTransitionContent = (
    <section className="flex h-full min-w-0 flex-1 flex-col items-center justify-center overflow-hidden bg-surface">
      <div className="flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500">
        <div className="relative flex h-20 w-20 items-center justify-center">
          {/* 外围旋转环 */}
          <div className="absolute inset-0 rounded-full border-[2.5px] border-primary/10 border-t-primary/60 animate-spin" style={{ animationDuration: '1.5s' }} />
          {/* 内围发光效果 */}
          <div className="absolute h-10 w-10 rounded-full bg-primary/20 blur-xl animate-pulse" style={{ animationDuration: '2s' }} />
          {/* 居中图标 */}
          <Layers className="relative z-10 h-7 w-7 text-primary/80" />
        </div>
        
        <div className="mt-8 flex flex-col items-center gap-2.5">
          <h3 className="text-[17px] font-black tracking-tight text-on-surface">
            {routeTransitionTitle}
          </h3>
          <div className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-primary/40 animate-pulse" style={{ animationDelay: '0ms' }} />
            <p className="text-[13px] font-medium tracking-wide text-ui-muted opacity-60">
              正在同步任务阶段，请稍等
            </p>
            <span className="h-1 w-1 rounded-full bg-primary/40 animate-pulse" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 overflow-hidden bg-surface">
      {view === "plan" && !isRouteSettling && isCompactLayout && layoutReady ? (
        <div className="absolute right-3 top-3 z-30 flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleCompactConversation}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-on-surface/20 bg-surface/95 px-3 py-1.5 text-[11px] font-bold text-on-surface-variant backdrop-blur transition-colors hover:bg-surface-container-low hover:text-on-surface"
          >
            <Layers className="h-3.5 w-3.5" />
            {compactConversationOpen ? "返回预览" : "查看会话"}
          </button>
          <button
            type="button"
            onClick={handleExitWorkbench}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-on-surface/20 bg-surface/95 px-3 py-1.5 text-[11px] font-bold text-on-surface-variant backdrop-blur transition-colors hover:bg-surface-container-low hover:text-on-surface"
          >
            <LogOut className="h-3.5 w-3.5" />
            退出
          </button>
        </div>
      ) : null}
      <ErrorBoundary fallbackTitle="页面加载出错了" className="flex-1">
        {layoutReady ? (
          <div className="flex flex-1 min-h-0 bg-transparent overflow-hidden">
            {isRouteSettling ? routeTransitionContent : view === "plan" ? planWorkbenchContent : singlePaneContent}
          </div>
        ) : renderLayoutSkeleton()}
      </ErrorBoundary>
      <ConfirmDialog
        open={exitConfirmOpen}
        title={stageView.isCompleted ? "结束本次整理？" : "暂存并退出当前任务？"}
        description={
          stageView.isCompleted
            ? "本次整理已顺利执行完毕，进度已安全归档，现在可以安全关闭工作台并返回首页。"
            : "当前的整理进度会自动保存。之后你可以随时从首页恢复并继续这项任务。"
        }
        confirmLabel={stageView.isCompleted ? "结束并返回" : "暂存并退出"}
        cancelLabel="留在工作台"
        tone="primary"
        loading={loading}
        onConfirm={handleConfirmExitWorkbench}
        onCancel={() => setExitConfirmOpen(false)}
      />
      <ConfirmDialog
        open={scanAbortConfirmOpen}
        title="停止本次扫描？"
        description="停止后会结束当前整理任务并返回首页。这一轮不会继续生成整理建议。"
        confirmLabel="停止扫描"
        cancelLabel="继续扫描"
        tone="danger"
        loading={scanAborting}
        onConfirm={handleConfirmAbortScan}
        onCancel={() => {
          if (!scanAborting) {
            setScanAbortConfirmOpen(false);
          }
        }}
      />
      <ConfirmDialog
        open={executeConfirmOpen}
        title="确认开始移动文件？"
        description={`执行后会真实移动本地文件。本次将处理 ${precheck?.move_preview.length ?? 0} 项${reviewMoveCount > 0 ? `，其中 ${reviewMoveCount} 项会留在待确认区` : ""}${precheckItemsSummary ? `。涉及条目：${precheckItemsSummary}` : ""}。`}
        confirmLabel="开始移动"
        cancelLabel="再看看"
        tone="primary"
        loading={loading}
        verificationText={(precheck && ((precheck.warnings || []).length > 0 || reviewMoveCount > 0)) ? "YES" : undefined}
        verificationPlaceholder="请输入大写 YES 确认执行"
        onConfirm={async () => {
          setExecuteConfirmOpen(false);
          await execute();
        }}
        onCancel={() => setExecuteConfirmOpen(false)}
      >
        <div className="grid gap-2 text-[13px]">
          <div className="flex items-center justify-between rounded-[10px] bg-surface-container-low px-3 py-2">
            <span className="text-ui-muted">本次将移动</span>
            <span className="font-semibold text-on-surface">{precheck?.move_preview.length ?? 0} 项</span>
          </div>
          <div className="flex items-center justify-between rounded-[10px] bg-surface-container-low px-3 py-2">
            <span className="text-ui-muted">本次将创建目录</span>
            <span className="font-semibold text-on-surface">{precheck?.mkdir_preview.length ?? 0} 个</span>
          </div>
          <div className="flex items-center justify-between rounded-[10px] bg-surface-container-low px-3 py-2">
            <span className="text-ui-muted">留在待确认区</span>
            <span className="font-semibold text-on-surface">{reviewMoveCount} 项</span>
          </div>
        </div>
      </ConfirmDialog>
      <RollbackPreviewDialog
        open={rollbackConfirmOpen}
        precheck={rollbackPrecheck}
        loading={loading}
        onConfirm={() => void handleConfirmRollback()}
        onCancel={handleCancelRollback}
      />
    </div>
  );
}
