"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AlertTriangle, Bot, Layers, Loader2, RefreshCw } from "lucide-react";
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

export default function WorkspaceClient() {
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
    activityFeed,
    assistantRuntime,
    composerStatus,
    chatError,
    streamStatus,
    composerMode,
    isComposerLocked,
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
  const [leftWidth, setLeftWidth] = useState(62);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"conversation" | "preview">("conversation");
  const [dividerLeft, setDividerLeft] = useState<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const leftPaneRef = React.useRef<HTMLElement>(null);
  const [isResizingState, setIsResizingState] = useState(false);
  const isResizing = React.useRef(false);

  React.useEffect(() => {
    const saved = localStorage.getItem("workspace_sidebar_width");
    if (saved) {
      const val = parseFloat(saved);
      if (val > 35 && val < 75) {
        setLeftWidth(val);
      }
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
  const showConversationPane = !["ready_to_execute", "completed"].includes(stage);
  const effectiveComposerMode = isReadOnly ? "hidden" : composerMode;
  const preferredMobileTab = useMemo<"conversation" | "preview">(() => {
    if (isReadOnly || stage === "ready_to_execute" || stage === "completed") {
      return "preview";
    }
    return "conversation";
  }, [isReadOnly, stage]);

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

    const minLeftPx = 400;
    const minRightPx = 340;
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
    if (isReadOnly) {
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

  const statusNotice = useMemo<ConversationNotice | null>(() => {
    if (isReadOnly && stage !== "completed") {
      return {
        tone: "warning",
        title: "这是只读模式",
        description: "你现在可以查看之前的方案和记录，但不会继续修改、预检或执行。如需继续整理，请回到首页重新选择。",
      };
    }

    if (stage === "ready_for_precheck" || (stage === "planning" && plan.readiness.can_precheck)) {
      return null;
    }

    if (stage === "ready_to_execute") {
      return {
        tone: "info",
        title: "预检已完成",
        description: "系统已经检查过真实文件系统。你可以先看看右侧的目录变化，再决定是否执行。",
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
        description: "目录内容已经变化，建议先重新扫描，再继续整理。",
        primaryAction: {
          label: "重新扫描",
          onClick: () => void refreshPlan(),
        },
        secondaryAction: {
          label: "结束这次整理",
          onClick: handleExitWorkbench,
        },
      };
    }

    if (stage === "interrupted") {
      return {
        tone: "danger",
        title: "处理被中断了",
        description: snapshot?.last_error || "可以重新扫描一次，确认目录状态后再继续。",
        primaryAction: {
          label: "重新扫描",
          onClick: () => void refreshPlan(),
        },
        secondaryAction: {
          label: "结束这次整理",
          onClick: handleExitWorkbench,
        },
      };
    }

    if (stage === "completed") {
      return {
        tone: "info",
        title: isReadOnly ? "这是之前的整理结果" : "整理完成",
        description: isReadOnly ? "这里只用于查看结果，不会触发新的操作。" : "右侧会显示这次整理的结果，也可以在这里继续处理后续步骤。",
      };
    }

    return null;
  }, [isReadOnly, plan.readiness.can_precheck, refreshPlan, returnToPlanning, snapshot?.last_error, stage]);

  React.useEffect(() => {
    if (stage === "completed" && !journal && !journalLoading && !isBusy) {
      void loadJournal();
    }
  }, [stage, journal, journalLoading, isBusy, loadJournal]);

  React.useEffect(() => {
    setMobileTab(preferredMobileTab);
  }, [preferredMobileTab]);

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

  const renderPreviewContent = () => {
    if (stage === "scanning") {
      return <MinimalScanningView scanner={scanner} progressPercent={progressPercent} />;
    }

    if (stage === "completed") {
      return (
        <div className="h-full overflow-y-auto p-5 max-w-[1040px] mx-auto lg:p-6 scrollbar-thin">
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
          />
        </div>
      );
    }

    if (stage === "ready_to_execute") {
      return (
        <div className="h-full overflow-y-auto p-4 lg:p-6 scrollbar-thin">
          <PrecheckView
            summary={precheck}
            isBusy={isBusy}
            readOnly={isReadOnly}
            onExecute={() => {
              if (!isReadOnly) {
                void execute();
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
            className="h-[70vh]"
          />
        ) : stage === "stale" || stage === "interrupted" ? (
          <div className="h-full overflow-y-auto p-5 lg:p-6 scrollbar-thin">
            <div className="rounded-lg border border-warning/20 bg-warning-container/15 p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="mt-1 rounded-lg bg-warning/15 p-3 text-warning">
                  {stage === "interrupted" ? <AlertTriangle className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
                </div>
                <div className="space-y-3">
                  <h3 className="text-lg font-bold text-on-surface">
                    {stage === "interrupted" ? "处理被中断了" : "当前方案已过期"}
                  </h3>
                  <p className="text-sm leading-6 text-on-surface-variant">
                    {stage === "interrupted"
                      ? (snapshot?.last_error || "请重新刷新方案，确认目录状态后再继续。")
                      : "目录内容已经变化，建议先重新扫描后再继续。"}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void refreshPlan()}
                      className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90"
                    >
                      重新扫描
                    </button>
                    <button
                      type="button"
                      onClick={handleExitWorkbench}
                      className="rounded-lg border border-on-surface/10 px-4 py-2.5 text-sm font-bold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
                    >
                      结束这次整理
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
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
        )}
      </ErrorBoundary>
    );
  };

  const conversationPanel = (
    <ConversationPanel
      messages={chatMessages}
      assistantDraft={assistantDraft}
      activityFeed={activityFeed}
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
    />
  );

  const conversationHeader = (
    <div className="shrink-0 px-5 py-4 flex items-center justify-between border-b border-on-surface/5 bg-surface/55 backdrop-blur-xl z-20 gap-4 lg:px-10 lg:py-5 lg:h-[88px]">
      <div className="flex items-center gap-4 min-w-0">
        <div className="hidden sm:flex w-10 h-10 rounded-lg bg-white/50 items-center justify-center text-primary/70 border border-on-surface/[0.03] shadow-xs shrink-0">
          <Bot className="w-5 h-5" />
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-ui-title font-black text-on-surface truncate">
              {getFriendlyStage(stage)}
            </h2>
            <span className="rounded-md bg-primary/8 border border-primary/10 px-2 py-0.5 text-ui-meta font-semibold text-primary/80 whitespace-nowrap">
              文件整理工作台
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-meta">
            <p className="truncate max-w-[36rem] text-ui-muted">
              {snapshot?.target_dir || dirParam || "..."}
            </p>
            {assistantRuntime ? (
              <span className="flex items-center gap-1.5 text-primary/70">
                <Loader2 className="h-3 w-3 animate-spin-slow" />
                {assistantRuntime.label}
              </span>
            ) : null}
            {streamStatus !== "connected" ? (
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium border",
                  streamStatus === "connecting"
                    ? "border-warning/20 bg-warning-container/20 text-warning"
                    : "border-on-surface/10 bg-surface-container-low text-ui-muted",
                )}
              >
                {streamStatus === "connecting" ? "正在连接" : "离线"}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={handleExitWorkbench}
          className="text-[12px] font-medium text-ui-muted px-3 py-2 rounded-lg transition-all hover:text-error hover:bg-error-container/10"
        >
          结束会话
        </button>
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className="flex-1 flex min-h-0 overflow-hidden relative bg-surface">
      <ErrorBoundary fallbackTitle="页面加载出错了" className="flex-1">
        <div className="hidden lg:flex flex-1 min-h-0">
          {showConversationPane ? (
            <section
              ref={leftPaneRef}
              style={{ width: `${leftWidth}%` }}
              className="relative flex min-h-0 h-full min-w-[400px] flex-col"
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
                isResizingState ? "bg-transparent" : "hover:bg-primary/[0.03]",
              )}
              style={{ left: dividerLeft !== null ? `${dividerLeft - 1.25}px` : `calc(${leftWidth}% - 1.25px)` }}
            >
              <div
                className={cn(
                  "w-[1px] h-full transition-all duration-300",
                  isResizingState
                    ? "bg-primary/40 shadow-[0_0_15px_rgba(76,98,88,0.4)] scale-x-[1.5]"
                    : "bg-on-surface/[0.04] group-hover:bg-primary/20",
                )}
              />
              <div
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 w-5 h-9 rounded-md bg-white border border-on-surface/5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col items-center justify-center gap-0.5 transition-all duration-200",
                  isResizingState
                    ? "opacity-100 scale-110 shadow-[0_4px_12px_rgba(0,0,0,0.08)] border-primary/20"
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
            className="flex min-h-0 h-full min-w-[340px] flex-col bg-surface overflow-hidden"
          >
            <div className="flex-1 min-h-0">{renderPreviewContent()}</div>
          </section>
        </div>

        <div className="flex lg:hidden flex-1 min-h-0 flex-col">
          {showConversationPane ? (
            <>
              {conversationHeader}
              <div className="shrink-0 border-b border-on-surface/5 bg-surface/80 px-4 py-3 backdrop-blur-sm">
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-container-low/70 p-1 border border-on-surface/5">
                  {[
                    { id: "conversation", label: "对话" },
                    { id: "preview", label: "预览" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setMobileTab(tab.id as "conversation" | "preview")}
                      className={cn(
                        "rounded-md px-4 py-2.5 text-[13px] font-semibold transition-all",
                        mobileTab === tab.id
                          ? "bg-white text-on-surface shadow-sm border border-on-surface/5"
                          : "text-ui-muted",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          <div className="flex-1 min-h-0 overflow-hidden">
            {showConversationPane && mobileTab === "conversation" ? (
              conversationPanel
            ) : (
              <section className="flex min-h-0 h-full flex-col bg-surface overflow-hidden">
                <div className="flex-1 min-h-0">{renderPreviewContent()}</div>
              </section>
            )}
          </div>
        </div>
      </ErrorBoundary>
      <ConfirmDialog
        open={exitConfirmOpen}
        title="结束当前整理？"
        description="确认后会放弃当前会话并返回首页。未完成的整理记录仍会保留在历史档案中。"
        confirmLabel="结束整理"
        cancelLabel="继续整理"
        tone="danger"
        loading={loading}
        onConfirm={handleConfirmExitWorkbench}
        onCancel={() => setExitConfirmOpen(false)}
      />
    </div>
  );
}
