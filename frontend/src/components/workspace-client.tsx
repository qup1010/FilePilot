"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AlertTriangle, Bot, Layers, RefreshCw } from "lucide-react";

import { useSession } from "@/lib/use-session";
import { getFriendlyStage } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { EmptyState } from "@/components/ui/empty-state";
import { ScanningOverlay } from "./workspace/scanning-overlay";
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
    chatError,
    streamStatus,
    composerMode,
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
  const isResizing = React.useRef(false);

  // Persistence for sidebar width
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

  const handleStartResizing = () => {
    isResizing.current = true;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", stopResizing);
    document.body.style.cursor = "col-resize";
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isResizing.current) {
      return;
    }
    const newWidth = (event.clientX / window.innerWidth) * 100;
    if (newWidth > 35 && newWidth < 75) {
      setLeftWidth(newWidth);
    }
  };

  const stopResizing = () => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", stopResizing);
    document.body.style.cursor = "default";
    saveWidth(leftWidth);
  };

  const handleSendMessage = async () => {
    if (isReadOnly || !messageInput.trim() || isBusy) {
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
    if (window.confirm("确定要放弃当前会话并返回首页吗？")) {
      abandonSession().then((success) => {
        if (success) {
          router.push("/");
        }
      });
    }
  };

  const statusNotice = useMemo<ConversationNotice | null>(() => {
    if (isReadOnly && stage !== "completed") {
      return {
        tone: "warning",
        title: "这是旧会话的只读视图",
        description: "你当前只能查看旧草案和历史消息，不能继续提交修改、预检或执行。如需继续整理，请返回启动页选择恢复上次整理或重新开始。",
      };
    }

    if (stage === "ready_for_precheck" || (stage === "planning" && plan.readiness.can_precheck)) {
      return {
        tone: "info",
        title: "当前整理草案已满足预检条件",
        description: "当前已经没有待确认项，结构校验也已通过。你可以开始预检真实文件系统冲突；这一步不会立即执行文件移动。",
        primaryAction: isReadOnly ? undefined : {
          label: "开始预检",
          onClick: () => {
            void runPrecheck();
          },
        },
      };
    }

    if (stage === "ready_to_execute") {
      return {
        tone: "info",
        title: "真实文件系统预检已完成",
        description: "当前草案已经通过真实文件系统检查。请在右侧核对目录树前后变化，再决定是否执行。",
        primaryAction: isReadOnly ? undefined : {
          label: "返回修改方案",
          onClick: () => {
            void returnToPlanning();
          },
        },
      };
    }

    if (stage === "stale") {
      return {
        tone: "warning",
        title: "会话已失效",
        description: "目录内容发生了变化，请重新刷新当前方案后再继续整理。",
        primaryAction: {
          label: "重新扫描并刷新",
          onClick: () => void refreshPlan(),
        },
        secondaryAction: {
          label: "放弃会话",
          onClick: handleExitWorkbench,
        },
      };
    }

    if (stage === "interrupted") {
      return {
        tone: "danger",
        title: "上一次运行被中断",
        description: snapshot?.last_error || "请重新刷新方案，确认当前目录状态后再继续。",
        primaryAction: {
          label: "重新刷新方案",
          onClick: () => void refreshPlan(),
        },
        secondaryAction: {
          label: "放弃会话",
          onClick: handleExitWorkbench,
        },
      };
    }

    if (stage === "completed") {
      return {
        tone: "info",
        title: isReadOnly ? "历史整理结果（只读）" : "整理已完成",
        description: isReadOnly ? "当前仅查看历史结果，不会触发新的执行或回退动作。" : "左侧保留本次会话摘要，右侧展示执行结果与回退操作。",
      };
    }

    return null;
  }, [isReadOnly, plan.readiness.can_precheck, refreshPlan, runPrecheck, returnToPlanning, snapshot?.last_error, stage]);

  React.useEffect(() => {
    if (stage === "completed" && !journal && !journalLoading && !isBusy) {
      void loadJournal();
    }
  }, [stage, journal, journalLoading, isBusy, loadJournal]);

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden relative bg-surface">
      <ErrorBoundary fallbackTitle="工作台引擎崩溃" className="flex-1">
        {showConversationPane ? (
        <section style={{ width: `${leftWidth}%` }} className="relative flex min-h-0 h-full min-w-[400px] flex-col">
          <div className="shrink-0 px-8 py-5 min-h-[104px] flex items-start justify-between border-b border-on-surface/5 bg-surface/88 backdrop-blur-sm z-10 gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-2xl bg-white/80 flex items-center justify-center text-primary border border-on-surface/5">
                <Bot className="w-4.5 h-4.5" />
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-base font-bold font-headline text-on-surface tracking-tight">
                    文件整理助手
                  </h2>
                  {streamStatus === "connecting" && (
                    <span className="flex items-center gap-1.5 text-[10px] font-bold text-warning/80 uppercase tracking-wider animate-pulse">
                      <div className="w-1.5 h-1.5 rounded-full bg-warning" />
                      连接波动
                    </span>
                  )}
                  {streamStatus === "disconnected" && (
                    <span className="flex items-center gap-1.5 text-[10px] font-bold text-error/60 uppercase tracking-wider">
                      <div className="w-1.5 h-1.5 rounded-full bg-error/40" />
                      停止连接
                    </span>
                  )}
                  <span className="rounded-full bg-surface-container px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                    {getFriendlyStage(stage)}
                  </span>
                  {snapshot?.strategy ? (
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      {snapshot.strategy.template_label}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-on-surface-variant truncate max-w-[320px]">
                  {snapshot?.target_dir || dirParam || "..."}
                </p>
                {snapshot?.strategy ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-on-surface-variant border border-on-surface/8">
                        {snapshot.strategy.naming_style_label}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-on-surface-variant border border-on-surface/8">
                        {snapshot.strategy.caution_level_label}
                      </span>
                    </div>
                    {snapshot.strategy.note ? (
                      <p className="max-w-[340px] truncate text-xs leading-5 text-on-surface-variant/75">
                        偏好：{snapshot.strategy.note}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <button
              onClick={handleExitWorkbench}
              className="text-xs font-medium text-on-surface-variant hover:text-error px-3 py-2 rounded-full transition-colors hover:bg-error-container/10"
            >
              退出工作台
            </button>
          </div>

          <ConversationPanel
            messages={chatMessages}
            assistantDraft={assistantDraft}
            activityFeed={activityFeed}
            error={chatError}
            composerMode={effectiveComposerMode}
            isBusy={isBusy}
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
        </section>
        ) : null}

        {showConversationPane ? (
          <div
            onMouseDown={handleStartResizing}
            className="absolute top-0 bottom-0 w-1 hover:bg-primary/20 cursor-col-resize z-20 transition-all flex items-center justify-center group"
            style={{ left: `calc(${leftWidth}% - 0.5px)` }}
          >
            <div className="w-[1px] h-full bg-on-surface/5 transition-colors group-hover:bg-primary/40" />
          </div>
        ) : null}

        <section
          style={{ width: showConversationPane ? `${100 - leftWidth}%` : "100%" }}
          className="flex min-h-0 h-full min-w-[340px] flex-col bg-surface overflow-y-auto"
        >
          <div className="flex-1">
            {stage === "scanning" ? (
              <div className="p-10">
                <ScanningOverlay scanner={scanner} progressPercent={progressPercent} />
              </div>
            ) : stage === "completed" ? (
              <div className="p-10 max-w-4xl mx-auto">
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
            ) : stage === "ready_to_execute" ? (
              <div className="p-10">
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
            ) : (
              <ErrorBoundary fallbackTitle="预览区加载失败">
                {stage === "idle" || stage === "draft" ? (
                  <EmptyState
                    icon={Layers}
                    title="方案预览准备中"
                    description="在此预览 AI 架构师为你构建的目录映射。请先点击左侧启动深度扫描。"
                    className="h-[70vh]"
                  />
                ) : stage === "stale" || stage === "interrupted" ? (
                  <div className="p-10">
                    <div className="rounded-2xl border border-warning/20 bg-warning-container/15 p-6 shadow-sm">
                      <div className="flex items-start gap-4">
                        <div className="mt-1 rounded-full bg-warning/15 p-3 text-warning">
                          {stage === "interrupted" ? <AlertTriangle className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
                        </div>
                        <div className="space-y-3">
                          <h3 className="text-lg font-bold text-on-surface">
                            {stage === "interrupted" ? "会话已中断" : "会话已失效"}
                          </h3>
                          <p className="text-sm leading-6 text-on-surface-variant">
                            {stage === "interrupted"
                              ? (snapshot?.last_error || "请重新刷新方案，确认目录状态后再继续。")
                              : "目录内容已经变化，原先方案可能不再安全，请先重新刷新。"}
                          </p>
                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => void refreshPlan()}
                              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90"
                            >
                              重新刷新方案
                            </button>
                            <button
                              type="button"
                              onClick={handleExitWorkbench}
                              className="rounded-xl border border-on-surface/10 px-4 py-2.5 text-sm font-bold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
                            >
                              放弃当前会话
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
            )}
          </div>
        </section>
      </ErrorBoundary>
    </div>
  );
}
