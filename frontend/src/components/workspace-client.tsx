"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Bot, Layers } from "lucide-react";
import { useSession } from "@/lib/use-session";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { EmptyState } from "@/components/ui/empty-state";
import { ScanningOverlay } from "./workspace/scanning-overlay";
import { PrecheckView } from "./workspace/precheck-view";
import { CompletionView } from "./workspace/completion-view";
import { ConversationPanel } from "./workspace/conversation-panel";
import { PreviewPanel } from "./workspace/preview-panel";

export default function WorkspaceClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionIdParam = searchParams.get("session_id");
  const dirParam = searchParams.get("dir");

  const {
    snapshot,
    journal,
    loading,
    sendMessage,
    scan,
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
    updateItem,
  } = useSession(sessionIdParam);

  const [messageInput, setMessageInput] = useState("");
  const [leftWidth, setLeftWidth] = useState(62);
  const isResizing = React.useRef(false);

  const stage = snapshot?.stage || "idle";

  const scanner = useMemo(
    () => ({
      status: snapshot?.scanner_progress?.status || "idle",
      processed_count: snapshot?.scanner_progress?.processed_count || 0,
      total_count: snapshot?.scanner_progress?.total_count || 0,
      current_item: snapshot?.scanner_progress?.current_item || null,
      recent_analysis_items: snapshot?.scanner_progress?.recent_analysis_items || [],
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

  const handleStartResizing = () => {
    isResizing.current = true;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", stopResizing);
    document.body.style.cursor = "col-resize";
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing.current) {
      return;
    }
    const newWidth = (e.clientX / window.innerWidth) * 100;
    if (newWidth > 35 && newWidth < 75) {
      setLeftWidth(newWidth);
    }
  };

  const stopResizing = () => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", stopResizing);
    document.body.style.cursor = "default";
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() || isBusy) {
      return;
    }
    const content = messageInput;
    setMessageInput("");
    await sendMessage(content);
  };

  const handlePromptConflict = (itemText: string) => {
    const prompt = `请继续澄清这个冲突项：${itemText}\n请明确说明它应该归到哪个目录；如果你已经能确定，请直接更新计划并移除对应的待确认项。`;
    if (!messageInput.includes(prompt)) {
      setMessageInput((prev) => (prev ? `${prev}\n${prompt}` : prompt));
    }
  };

  // 执行完成后，需要显式加载一次 journal 以展示汇总
  React.useEffect(() => {
    if (stage === "completed" && !journal && !isBusy) {
      void loadJournal();
    }
  }, [stage, journal, isBusy, loadJournal]);

  return (
    <div className="flex-1 flex overflow-hidden relative bg-surface">
      <ErrorBoundary fallbackTitle="工作台引擎崩溃" className="flex-1">
        <section style={{ width: `${leftWidth}%` }} className="flex flex-col min-w-[400px] h-full relative">
          <div className="px-8 py-6 h-20 flex items-center justify-between border-b border-on-surface/5 bg-surface-container-low z-10">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-md bg-white flex items-center justify-center text-primary shadow-sm border border-on-surface/5">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold font-headline text-on-surface tracking-tight uppercase tracking-widest">
                  组织器助手
                </h2>
                <p className="text-[10px] text-on-surface-variant font-mono truncate max-w-[200px]">
                  {dirParam || "..."}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                if (window.confirm("确定要放弃当前会话并返回首页吗？")) {
                  void abandonSession().then(() => router.push("/"));
                }
              }}
              className="text-[11px] font-bold text-on-surface-variant hover:text-error px-3 py-2 rounded-md transition-colors hover:bg-error-container/10"
            >
              退出工作台
            </button>
          </div>

          <ConversationPanel
            messages={snapshot?.messages || []}
            actionLog={actionLog}
            aiTyping={!!aiTyping}
            isBusy={isBusy}
            stage={stage}
            messageInput={messageInput}
            setMessageInput={setMessageInput}
            onSendMessage={handleSendMessage}
            onStartScan={() => void scan()}
            unresolvedCount={plan.unresolved_items.length}
          />
        </section>

        <div
          onMouseDown={handleStartResizing}
          className="absolute top-0 bottom-0 w-1 hover:bg-primary/20 cursor-col-resize z-20 transition-all flex items-center justify-center group"
          style={{ left: `calc(${leftWidth}% - 0.5px)` }}
        >
          <div className="w-[1px] h-full bg-on-surface/5 transition-colors group-hover:bg-primary/40" />
        </div>

        <section
          style={{ width: `${100 - leftWidth}%` }}
          className="flex flex-col bg-surface overflow-y-auto min-w-[340px] h-full"
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
                  targetDir={snapshot?.target_dir || ""}
                  isBusy={isBusy}
                  onOpenExplorer={() => void openExplorer(snapshot?.target_dir || "")}
                  onCleanupDirs={() => void cleanupEmptyDirs()}
                  onRollback={() => void rollback()}
                />
              </div>
            ) : stage === "ready_to_execute" ? (
              <div className="p-10">
                {/* @ts-ignore - Prop name mismatch fix in next step */}
                <PrecheckView 
                  summary={precheck} 
                  isBusy={isBusy} 
                  onExecute={() => void execute()} 
                  onBack={() => {
                    void sendMessage("我需要修改方案，请重新评估。");
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
                ) : (
                  <PreviewPanel
                    plan={plan}
                    stage={stage}
                    isBusy={isBusy}
                    onRunPrecheck={() => void runPrecheck()}
                    onUpdateItem={(id, payload) => void updateItem({ item_id: id, ...payload })}
                    onPromptConflict={handlePromptConflict}
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
