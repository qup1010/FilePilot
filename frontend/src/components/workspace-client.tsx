"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AlertTriangle, FolderTree, Layers, Loader2, MoreHorizontal, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

import { useSession } from "@/lib/use-session";
import { getFriendlyStage } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MinimalScanningView } from "./workspace/minimal-scanning-view";
import { PrecheckView } from "./workspace/precheck-view";
import { CompletionView } from "./workspace/completion-view";
import { ConversationPanel, type ConversationNotice } from "./workspace/conversation-panel";
import { PreviewPanel } from "./workspace/preview-panel";

const DEFAULT_LEFT_WIDTH = 50;

export default function WorkspaceClient() {
  const APP_CONTEXT_EVENT = "file-organizer-context-change";
  const WORKSPACE_CONTEXT_KEY = "workspace_header_context";
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionIdParam = searchParams.get("session_id");
  const dirParam = searchParams.get("dir");
  const isReadOnly = searchParams.get("readonly") === "1";

  const {
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
    retryStream,
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
  } = useSession(sessionIdParam);

  const [messageInput, setMessageInput] = useState("");
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [layoutReady, setLayoutReady] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [executeConfirmOpen, setExecuteConfirmOpen] = useState(false);
  const [scanAbortConfirmOpen, setScanAbortConfirmOpen] = useState(false);
  const [showExitMenu, setShowExitMenu] = useState(false);
  const [dividerLeft, setDividerLeft] = useState<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const leftPaneRef = React.useRef<HTMLElement>(null);
  const [isResizingState, setIsResizingState] = useState(false);
  const isResizing = React.useRef(false);

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
    }),
    [snapshot?.scanner_progress],
  );

  const plan = useMemo(
    () => ({
      summary: snapshot?.plan_snapshot?.summary || "",
      items: snapshot?.plan_snapshot?.items || [],
      groups: snapshot?.plan_snapshot?.groups || [],
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
  const isBusy = ["scanning", "executing", "rolling_back"].includes(stage) || loading;
  const progressPercent = scanner.total_count > 0 ? (scanner.processed_count / scanner.total_count) * 100 : 0;
  const showConversationPane = true;
  const effectiveComposerMode = isReadOnly ? "hidden" : composerMode;
  const targetPath = snapshot?.target_dir || dirParam || "";
  const targetDirName = useMemo(
    () => targetPath.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "当前任务",
    [targetPath],
  );
  const nextStepHint = useMemo(() => {
    if (isReadOnly && stage !== "completed") {
      return "当前为只读查看模式。如需继续整理，请返回首页重新启动或恢复任务。";
    }
    if (stage === "idle" || stage === "draft") {
      return "下一步请先开始扫描。系统会读取目录结构并建立初始分析范围。";
    }
    if (stage === "scanning") {
      return "扫描完成后会自动进入第一版整理方案，无需手动切换页面。";
    }
    if (stage === "planning") {
      return plan.readiness.can_precheck
        ? "下一步建议运行预检，确认目录创建和文件移动是否可以执行。"
        : "可以继续补充要求或调整条目，直到方案进入可预检状态。";
    }
    if (stage === "ready_for_precheck") {
      return "下一步建议运行预检，确认目录创建和文件移动范围。";
    }
    if (stage === "ready_to_execute") {
      return "预检已完成。请结合右侧影响范围决定执行或返回修改。";
    }
    if (stage === "executing") {
      return "系统正在按预检后的方案执行文件变更，完成后会进入结果页。";
    }
    if (stage === "completed") {
      return "左侧会保留本轮记录供你回看；右侧可查看结果、处理失败项、清理空目录或执行回退。";
    }
    if (stage === "stale" || stage === "interrupted") {
      return "建议先重新扫描，确认目录状态后再继续整理。";
    }
    return "当前任务正在继续推进。";
  }, [isReadOnly, plan.readiness.can_precheck, stage]);

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

    const minLeftPx = 360;
    const minRightPx = 320;
    const maxLeftPx = Math.max(minLeftPx, rect.width - minRightPx);
    const boundedX = Math.min(Math.max(event.clientX - rect.left, minLeftPx), maxLeftPx);
    const newWidth = (boundedX / rect.width) * 100;
    setLeftWidth(newWidth);
  }, []);

  const stopResizing = React.useCallback(() => {
    isResizing.current = false;
    setIsResizingState(false);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", stopResizing);
    document.body.style.cursor = "default";
    document.body.style.userSelect = "";
    document.body.style.webkitUserSelect = "";
    saveWidth(leftWidth);
  }, [handleMouseMove, leftWidth, saveWidth]);

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
    const content = messageInput;
    setMessageInput("");
    await sendMessage(content);
  };

  const handleExitWorkbench = () => {
    setShowExitMenu(false);
    if (isReadOnly || stage === "completed") {
      router.push("/");
      return;
    }

    setExitConfirmOpen(true);
  };

  const handleConfirmExitWorkbench = async () => {
    const success = await abandonSession();
    if (success) {
      setExitConfirmOpen(false);
      router.push("/");
    }
  };

  const handleConfirmAbortScan = async () => {
    const success = await abandonSession();
    if (success) {
      setScanAbortConfirmOpen(false);
      router.push("/");
    }
  };


  const statusNotice = useMemo<ConversationNotice | null>(() => {
    if (streamStatus === "offline") {
      return {
        tone: "warning",
        title: "实时连接已断开",
        description: stage === "completed"
          ? "当前页面会保留已同步的记录和结果，输入已关闭。你可以先查看右侧结果，或重新连接恢复实时状态。"
          : "当前页面仍可查看已同步内容。重新连接后，会恢复实时事件更新并重新同步当前任务。",
        primaryAction: {
          label: "重新连接",
          onClick: () => {
            void retryStream();
          },
        },
      };
    }

    if (isReadOnly && stage !== "completed") {
      return {
        tone: "warning",
        title: "这是只读模式",
        description: "当前只能查看之前的方案和记录，不能继续修改、预检或执行。如需继续整理，请返回首页重新选择。",
      };
    }

    if (stage === "ready_for_precheck" || (stage === "planning" && plan.readiness.can_precheck)) {
      return null;
    }

    if (stage === "ready_to_execute") {
      return {
        tone: "info",
        title: "预检已完成",
        description: "系统已经检查过真实文件系统。请结合右侧影响范围，决定是否执行或返回修改。",
        primaryAction: isReadOnly ? undefined : {
          label: "返回继续修改",
          onClick: () => {
            void returnToPlanning();
          },
        },
      };
    }

    if (stage === "stale") {
      return {
        tone: "warning",
        title: "当前方案已过期",
        description: "目录内容已发生变化。建议先重新扫描，再继续整理。",
        primaryAction: {
          label: "重新扫描",
          onClick: () => void refreshPlan(),
        },
        secondaryAction: {
          label: "结束本次任务",
          onClick: handleExitWorkbench,
        },
      };
    }

    if (stage === "interrupted") {
      return {
        tone: "danger",
        title: "任务已中断",
        description: snapshot?.last_error || "建议重新扫描一次，确认目录状态后再继续。",
        primaryAction: {
          label: "重新扫描",
          onClick: () => void refreshPlan(),
        },
        secondaryAction: {
          label: "结束本次任务",
          onClick: handleExitWorkbench,
        },
      };
    }

    if (stage === "completed") {
      return {
        tone: "info",
        title: isReadOnly ? "这是之前的整理结果" : "整理完成",
        description: isReadOnly
          ? "左侧保留了当时的记录，输入已关闭；右侧可以继续查看这次整理结果。"
          : "左侧会保留本轮记录供你回看，输入已关闭；请在右侧查看结果、失败项、Review 和后续操作。",
      };
    }

    return null;
  }, [isReadOnly, plan.readiness.can_precheck, refreshPlan, returnToPlanning, retryStream, snapshot?.last_error, stage, streamStatus]);

  React.useEffect(() => {
    if (stage === "completed" && !journal && !journalLoading && !isBusy) {
      void loadJournal();
    }
  }, [stage, journal, journalLoading, isBusy, loadJournal]);

  React.useEffect(() => {
    if (!showConversationPane) {
      setDividerLeft(null);
      return;
    }

    const container = containerRef.current;
    const leftPane = leftPaneRef.current;
    if (!container || !leftPane) {
      return;
    }

    const updateDivider = () => {
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
  }, [showConversationPane, leftWidth]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const targetPath = snapshot?.target_dir || dirParam || "";
    const dirName = targetPath ? targetPath.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "当前任务" : "当前任务";
    window.localStorage.setItem(
      WORKSPACE_CONTEXT_KEY,
      JSON.stringify({
        dirName,
        stage: getFriendlyStage(stage),
      }),
    );
    window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
  }, [APP_CONTEXT_EVENT, WORKSPACE_CONTEXT_KEY, dirParam, snapshot?.target_dir, stage]);

  const renderPreviewContent = () => {
    return (
      <AnimatePresence mode="wait">
        <motion.div
           key={stage}
           initial={{ opacity: 0, y: 4 }}
           animate={{ opacity: 1, y: 0 }}
           exit={{ opacity: 0, y: -4 }}
           transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
           className="h-full w-full"
        >
          {(() => {
            if (stage === "scanning") {
              return (
                <MinimalScanningView
                  scanner={scanner}
                  progressPercent={progressPercent}
                  onAbort={() => setScanAbortConfirmOpen(true)}
                  aborting={loading}
                />
              );
            }

            if (stage === "completed") {
              return (
                <div className="mx-auto h-full w-full max-w-[1360px] overflow-y-auto p-5 scrollbar-thin">
                  <CompletionView
                    journal={journal}
                    summary={snapshot?.summary || ""}
                    loading={journalLoading || !journal}
                    targetDir={snapshot?.target_dir || ""}
                    isBusy={isBusy}
                    readOnly={isReadOnly}
                    onOpenExplorer={() => void openExplorer(snapshot?.target_dir || "")}
                    onCleanupDirs={() => {
                      if (!isReadOnly) {
                        void cleanupEmptyDirs();
                      }
                    }}
                    onRollback={() => {
                      if (!isReadOnly) {
                        void rollback();
                      }
                    }}
                    onGoHome={handleExitWorkbench}
                  />
                </div>
              );
            }

            if (stage === "ready_to_execute") {
              return (
                <div className="mx-auto h-full w-full max-w-[1360px] overflow-y-auto p-5 scrollbar-thin">
                  <PrecheckView
                    summary={precheck}
                    isBusy={isBusy}
                    readOnly={isReadOnly}
                    onRequestExecute={() => {
                      if (!isReadOnly) {
                        setExecuteConfirmOpen(true);
                      }
                    }}
                    onBack={() => {
                      if (!isReadOnly) {
                        void returnToPlanning();
                      }
                    }}
                  />
                </div>
              );
            }

            return (
              <ErrorBoundary fallbackTitle="预览区加载失败">
                {stage === "idle" || stage === "draft" ? (
                  <EmptyState
                    icon={Layers}
                    title="整理预览准备中"
                    description="先开始扫描，系统会在这里显示整理前后的目录变化。"
                    className="mx-auto h-[70vh] max-w-[1360px]"
                  />
                ) : (
                  <div className="flex h-full flex-col">
                    {(stage === "stale" || stage === "interrupted") && (
                      <div className="z-10 border-b border-warning/15 bg-warning-container/8 px-4 py-2.5 backdrop-blur-sm">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-warning/15 text-warning">
                              <AlertTriangle className="h-4 w-4" />
                            </div>
                            <p className="text-[13px] font-medium text-on-surface">
                              {stage === "stale" ? "当前方案已过期，建议重新扫描以同步目录状态。" : "处理被中断，建议重新扫描核心目录。"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleExitWorkbench}
                              className="rounded-[6px] px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-on-surface/5"
                            >
                              稍后再说
                            </button>
                            <button
                              type="button"
                              onClick={() => void refreshPlan()}
                              className="inline-flex items-center gap-1.5 rounded-[8px] bg-warning px-3 py-1.5 text-[12px] font-bold text-white shadow-sm transition-opacity hover:opacity-90"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              立即刷新
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="flex-1 overflow-hidden">
                      <PreviewPanel
                        plan={plan}
                        stage={stage}
                        isBusy={isBusy}
                        readOnly={isReadOnly}
                        onRunPrecheck={() => {
                          if (!isReadOnly) {
                            void runPrecheck();
                          }
                        }}
                        onUpdateItem={(id, payload) => {
                          if (!isReadOnly) {
                            void updateItem({ item_id: id, ...payload });
                          }
                        }}
                      />
                    </div>
                  </div>
                )}
              </ErrorBoundary>
            );
          })()}
        </motion.div>
      </AnimatePresence>
    );
  };

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
      stage={stage}
      messageInput={messageInput}
      setMessageInput={setMessageInput}
      onSendMessage={handleSendMessage}
      onStartScan={() => void scan()}
      onResolveUnresolved={(payload) => {
        if (!isReadOnly) {
          void resolveUnresolvedChoices(payload);
        }
      }}
      unresolvedCount={plan.unresolved_items.length}
      notice={statusNotice}
      scanner={scanner}
      progressPercent={progressPercent}
    />
  );

  const conversationHeader = (
    <div className="z-20 flex shrink-0 items-start justify-between gap-3 border-b border-on-surface/8 bg-surface px-4 py-3.5 lg:px-5 lg:py-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-primary/10 bg-primary/[0.05] text-primary/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] sm:flex">
          <FolderTree className="h-4.5 w-4.5" />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h2 className="truncate text-[18px] font-black tracking-tight text-on-surface lg:text-[1.1rem]">
              {targetDirName}
            </h2>
            <span className="whitespace-nowrap rounded-[8px] border border-primary/12 bg-primary/8 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/85">
              Stage
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-on-surface/8 bg-surface-container-low px-2.5 py-1 font-semibold text-on-surface-variant">
              <span className="h-1.5 w-1.5 rounded-full bg-warning/80" />
              {getFriendlyStage(stage)}
            </span>
            {assistantRuntime ? (
              <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-primary/10 bg-primary/6 px-2.5 py-1 font-medium text-primary/75">
                <Loader2 className="h-3.5 w-3.5 animate-spin-slow" />
                {assistantRuntime.label}
              </span>
            ) : null}
            {streamStatus !== "connected" ? (
              <span
                className={cn(
                  "rounded-[8px] border px-2.5 py-1 font-medium",
                  streamStatus === "connecting" && "border-warning/20 bg-warning-container/20 text-warning",
                  streamStatus === "reconnecting" && "border-warning/20 bg-warning-container/30 text-warning",
                  streamStatus === "offline" && "border-on-surface/10 bg-surface-container-low text-ui-muted",
                )}
              >
                {streamStatus === "connecting"
                  ? "正在连接"
                  : streamStatus === "reconnecting"
                    ? "连接中断，重连中"
                    : "连接已断开"}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2 rounded-[10px] border border-on-surface/7 bg-surface-container-low/72 px-3 py-2 text-[12px]">
            <FolderTree className="h-3.5 w-3.5 shrink-0 text-primary/70" />
            <p className="truncate font-medium text-ui-muted">
              {targetPath || "..."}
            </p>
          </div>
          <p className="max-w-[44rem] text-[12px] leading-5 text-on-surface-variant/68">
            {nextStepHint}
          </p>
        </div>
      </div>

      <div className="relative flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => setShowExitMenu((current) => !current)}
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-on-surface/8 bg-surface-container-low px-3 py-1.5 text-[12px] font-medium text-on-surface-variant transition-colors hover:border-on-surface/12 hover:text-on-surface"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
          更多
        </button>
        {showExitMenu ? (
          <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[190px] rounded-[10px] border border-on-surface/8 bg-surface-container-lowest p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.12)]">
            <button
              type="button"
              onClick={handleExitWorkbench}
              className="w-full rounded-[8px] px-3 py-2 text-left text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-on-surface/5"
            >
              结束本次任务
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 overflow-hidden bg-surface">
      <ErrorBoundary fallbackTitle="页面加载出错了" className="flex-1">
        {layoutReady ? (
          <div className="flex flex-1 min-h-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.45),rgba(255,255,255,0))]">
            {showConversationPane ? (
              <section
                ref={leftPaneRef}
                style={{ width: `${leftWidth}%` }}
                className="relative flex h-full min-h-0 min-w-[360px] flex-col border-r border-on-surface/6 bg-surface-container-lowest"
              >
                {conversationHeader}
                {conversationPanel}
              </section>
            ) : null}

            {showConversationPane ? (
              <div
                onMouseDown={handleStartResizing}
                className={cn(
                  "absolute top-0 bottom-0 w-2.5 z-40 transition-colors cursor-col-resize flex items-center justify-center select-none group",
                  isResizingState ? "bg-transparent" : "hover:bg-primary/[0.018]",
                )}
                style={{ left: dividerLeft !== null ? `${dividerLeft - 1.25}px` : `calc(${leftWidth}% - 1.25px)` }}
              >
                <div
                  className={cn(
                    "w-[1px] h-full transition-all duration-300",
                    isResizingState
                      ? "bg-primary/35 shadow-[0_0_12px_rgba(0,120,212,0.18)] scale-x-[1.5]"
                      : "bg-on-surface/[0.06] group-hover:bg-primary/18",
                  )}
                />
                <div
                  className={cn(
                    "absolute top-1/2 flex h-9 w-5 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-[8px] border border-on-surface/8 bg-surface-container-lowest transition-all duration-200",
                    isResizingState
                      ? "scale-110 border-primary/20 opacity-100 shadow-[0_4px_10px_rgba(0,0,0,0.08)]"
                      : "opacity-0 group-hover:opacity-100 scale-100",
                  )}
                >
                  <div className={cn("w-[1.5px] h-3 rounded-sm transition-colors", isResizingState ? "bg-primary/40" : "bg-on-surface/15")} />
                  <div className={cn("w-[1.5px] h-3 rounded-sm transition-colors", isResizingState ? "bg-primary/40" : "bg-on-surface/15")} />
                </div>
              </div>
            ) : null}

            <section
              style={{ width: showConversationPane ? `${100 - leftWidth}%` : "100%" }}
              className="flex h-full min-h-0 min-w-[320px] flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(248,249,250,0.82),rgba(242,244,245,0.55))]"
            >
              <div className="flex-1 min-h-0">{renderPreviewContent()}</div>
            </section>
          </div>
        ) : renderLayoutSkeleton()}
      </ErrorBoundary>
      <ConfirmDialog
        open={exitConfirmOpen}
        title="回到首页？"
        description="当前的整理进度会自动保存。你之后可以随时从首页点击‘恢复先前任务’并继续。"
        confirmLabel="确认退出"
        cancelLabel="留在工作台"
        tone="primary"
        loading={loading}
        onConfirm={handleConfirmExitWorkbench}
        onCancel={() => setExitConfirmOpen(false)}
      />
      <ConfirmDialog
        open={scanAbortConfirmOpen}
        title="确认中断本次扫描？"
        description="中断后会结束当前整理任务并返回首页。这一轮扫描不会继续生成后续方案。"
        confirmLabel="确认中断"
        cancelLabel="继续扫描"
        tone="danger"
        loading={loading}
        onConfirm={handleConfirmAbortScan}
        onCancel={() => setScanAbortConfirmOpen(false)}
      />
      <ConfirmDialog
        open={executeConfirmOpen}
        title="确认执行这次整理？"
        description="执行后会真实移动本地文件。请在最后确认一次影响范围，避免误触发落盘。"
        confirmLabel="开始执行"
        cancelLabel="再看看"
        tone="primary"
        loading={loading}
        onConfirm={async () => {
          const success = await execute();
          if (success) {
            setExecuteConfirmOpen(false);
          }
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
            <span className="text-ui-muted">将进入 Review</span>
            <span className="font-semibold text-on-surface">
              {precheck?.move_preview.filter((move) => move.target.split(/[\\/]/).some((part) => part.toLowerCase() === "review")).length ?? 0} 项
            </span>
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}
