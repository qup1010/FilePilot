"use client";

import { motion } from "framer-motion";
import { 
  FolderOpen, 
  Activity,
  Undo2,
  Clock,
  ArrowRight,
  History as HistoryIcon,
  Search,
  Filter,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getSessionStageView } from "@/lib/session-view-model";
import { HistoryItem, SessionStage } from "@/types/session";
import { cn, formatDisplayDate } from "@/lib/utils";
import {
  clearActiveWorkspaceRouteForSession,
  getHistoryEntryHref,
  getHistoryEntrySummary,
  getHistoryDeletePrompt,
  isHistoryCompletedEntry,
  isHistoryPartialFailureEntry,
  isHistoryRollbackPartialFailureEntry,
  isHistoryRolledBackEntry,
  isHistorySessionEntry,
  useHistoryList,
} from "@/lib/use-history-list";

import { EmptyState } from "@/components/ui/empty-state";
import { FileRadarIllustration } from "@/components/ui/svg-illustrations";

function getDirectoryShortName(path: string | null) {
  if (!path) return "未指定目录";
  const segments = path.replace(/[\\/]$/, "").split(/[\\/]/);
  const last = segments[segments.length - 1];
  return last || path;
}

export function SessionHistory({ maxItems }: { maxItems?: number }) {
  const router = useRouter();
  const {
    history,
    query,
    setQuery,
    filter,
    setFilter,
    filteredHistory,
    pendingDeleteId,
    deletingId,
    requestDelete,
    cancelDelete,
    confirmDelete,
  } = useHistoryList();

  const handleContinue = (item: HistoryItem) => {
    router.push(getHistoryEntryHref(item));
  };

  const pendingDeleteEntry = pendingDeleteId
    ? history.find((entry) => entry.execution_id === pendingDeleteId) ?? null
    : null;
  const pendingDeletePrompt = getHistoryDeletePrompt(pendingDeleteEntry);

  const handleConfirmDelete = async () => {
    const entryToDelete = pendingDeleteEntry;
    const deletedId = await confirmDelete();
    if (deletedId && entryToDelete && isHistorySessionEntry(entryToDelete)) {
      clearActiveWorkspaceRouteForSession(deletedId);
    }
  };

  return (
    <div className="flex min-h-0 flex-col space-y-3 overflow-hidden rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4 min-[1680px]:h-full">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-2.5 text-[15px] font-black text-on-surface">
            <div className="flex h-6 w-6 items-center justify-center rounded-[8px] bg-primary/10">
              <HistoryIcon className="h-3.5 w-3.5 text-primary" />
            </div>
            最近记录
          </h3>
          <p className="text-[12px] font-medium text-ui-muted">
            最近的任务、执行结果和回退记录
          </p>
        </div>
        {history.length > 0 && (
          <button 
            onClick={() => router.push('/history')}
            className="group inline-flex shrink-0 items-center gap-2 rounded-[9px] border border-on-surface/8 bg-surface-container px-2.5 py-2 text-[12px] font-semibold text-primary transition-colors hover:bg-surface-container-low sm:px-3"
          >
            <span className="hidden 2xl:inline">查看全部记录</span>
            <span className="2xl:hidden">全部记录</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div className="space-y-2.5 rounded-[10px] bg-surface-container-low px-3 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索目录、时间或状态"
              className="w-full rounded-[9px] border border-on-surface/8 bg-surface-container-lowest py-2.5 pl-[2.625rem] pr-3 text-[14px] text-on-surface outline-none transition-all placeholder:text-ui-muted focus:border-primary/30 focus:ring-4 focus:ring-primary/5"
            />
          </div>
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-[8px] bg-surface-container-lowest px-2.5 py-1.5 text-[12px] font-medium text-ui-muted">
              <Filter className="h-3.5 w-3.5" />
              筛选
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "all", label: "全部" },
                { id: "active", label: "进行中" },
                { id: "completed", label: "已完成" },
                { id: "partial_failure", label: "部分失败" },
                { id: "rolled_back", label: "已回退" },
                { id: "rollback_partial_failure", label: "回退部分失败" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id as typeof filter)}
                  className={cn(
                    "w-full rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold transition-colors",
                    filter === item.id
                      ? "border-primary bg-primary text-white"
                      : "border-on-surface/8 bg-surface-container-lowest text-ui-muted hover:bg-surface-container-low hover:text-on-surface",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 scrollbar-thin">
        {history.length === 0 ? (
          <EmptyState
            illustration={FileRadarIllustration}
            title="还没有记录"
            description="完成第一次目录整理后，相关任务、执行结果和回退记录会出现在这里。"
            className="h-full py-12"
          />
        ) : (
          <div className="space-y-2.5">
          {(maxItems ? filteredHistory.slice(0, maxItems) : filteredHistory).map((item, idx) => {
            const isSession = isHistorySessionEntry(item);
            const sessionStageView = isSession ? getSessionStageView(item.status as SessionStage) : null;
            const isCompleted = isSession ? Boolean(sessionStageView?.isCompleted) : isHistoryCompletedEntry(item);
            const isRolledBack = isHistoryRolledBackEntry(item);
            const isPartialFailure = isHistoryPartialFailureEntry(item) || isHistoryRollbackPartialFailureEntry(item);
            const dirName = getDirectoryShortName(item.target_dir);
            
            const statusLabel = getHistoryEntrySummary(item);
            const hasFailures = (item.failure_count || 0) > 0;

            return (
              <motion.div
                key={item.execution_id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                role="button"
                tabIndex={0}
                onClick={() => handleContinue(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleContinue(item);
                  }
                }}
                className={cn(
                  "group cursor-pointer overflow-hidden rounded-xl border border-on-surface/6 bg-surface-container-lowest px-3 py-2 transition-all hover:border-primary/25 hover:bg-surface-container-low",
                  isRolledBack && "opacity-60 saturate-50 hover:opacity-90 hover:saturate-100 transition-all"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors border",
                    isRolledBack 
                      ? "bg-on-surface/5 border-on-surface/10 text-on-surface-variant/40" 
                      : isPartialFailure
                        ? "bg-warning/5 border-warning/10 text-warning"
                      : isCompleted
                        ? "bg-success/5 border-success/10 text-success-dim"
                        : "bg-primary/5 border-primary/10 text-primary"
                  )}>
                    {isRolledBack ? <Undo2 className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <h4 className={cn(
                          "truncate text-[12.5px] font-black text-on-surface group-hover:text-primary transition-colors",
                          isRolledBack && "text-ui-muted line-through opacity-70"
                        )}>
                          {dirName}
                        </h4>
                        <span className={cn(
                          "shrink-0 rounded-[4px] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border",
                          isRolledBack
                            ? "bg-on-surface/5 border-on-surface/10 text-ui-muted"
                            : isPartialFailure
                              ? "bg-warning/10 border-warning/20 text-warning"
                              : isCompleted
                                ? "bg-success/10 border-success/20 text-success-dim"
                                : "bg-primary/10 border-primary/20 text-primary"
                        )}>
                          {statusLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                         <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            requestDelete(item.execution_id);
                          }}
                          className="rounded-md p-1 text-ui-muted hover:bg-error/5 hover:text-error transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-3 text-[10.5px] font-medium text-ui-muted opacity-60">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDisplayDate(item.created_at)}
                        </span>
                        <span className="flex items-center gap-1 border-l border-on-surface/10 pl-2">
                          <FolderOpen className="h-3 w-3" />
                          {item.item_count || 0}
                        </span>
                        {hasFailures && (
                          <span className="font-black text-error">· {item.failure_count} 项失败</span>
                        )}
                      </div>
                      <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
          {filteredHistory.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-on-surface/10 bg-surface-container-low/35 px-4 py-8 text-center">
              <p className="text-[14px] font-medium text-ui-muted">没有找到匹配的记录，请调整关键词或筛选条件。</p>
            </div>
          ) : null}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(pendingDeleteId)}
        title={pendingDeletePrompt.title}
        description={pendingDeletePrompt.description}
        confirmLabel="确认删除"
        cancelLabel="取消"
        tone="danger"
        loading={deletingId === pendingDeleteId}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={cancelDelete}
      />
    </div>
  );
}
