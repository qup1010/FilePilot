"use client";

import { motion } from "framer-motion";
import { 
  FolderOpen, 
  Activity,
  CheckCircle2,
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
import { HistoryItem } from "@/types/session";
import { cn, getFriendlyStatus, formatDisplayDate, getFriendlyStage } from "@/lib/utils";
import { getHistoryEntryName, isHistorySessionEntry, useHistoryList } from "@/lib/use-history-list";

import { EmptyState } from "@/components/ui/empty-state";

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
    if (!isHistorySessionEntry(item)) {
      router.push(`/workspace?execution_id=${item.execution_id}`);
    } else {
      router.push(`/workspace?session_id=${item.execution_id}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-col space-y-3 overflow-hidden rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4 shadow-[0_6px_18px_rgba(0,0,0,0.04)] min-[1680px]:h-full">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-2.5 text-[15px] font-black text-on-surface">
            <div className="flex h-6 w-6 items-center justify-center rounded-[8px] bg-primary/10">
              <HistoryIcon className="h-3.5 w-3.5 text-primary" />
            </div>
            最近的整理记录
          </h3>
          <p className="text-[12px] font-medium text-ui-muted">
            最近的会话、结果和回退记录
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
              placeholder="搜索目录、状态或记录 ID"
              className="w-full rounded-[9px] border border-on-surface/8 bg-surface-container-lowest py-2.5 pl-[2.625rem] pr-3 text-[14px] text-on-surface outline-none transition-all placeholder:text-ui-muted focus:border-primary/30 focus:ring-4 focus:ring-primary/5"
            />
          </div>
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-[8px] bg-surface-container-lowest px-2.5 py-1.5 text-[12px] font-medium text-ui-muted">
              <Filter className="h-3.5 w-3.5" />
              快速筛选
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "all", label: "全部" },
                { id: "active", label: "进行中" },
                { id: "completed", label: "已完成" },
                { id: "rolled_back", label: "已回退" },
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
            icon={HistoryIcon}
            title="暂无整理记录"
            description="当你完成第一次目录整理后，相关的会话和执行日志会出现在这里。"
            className="h-full py-12"
          />
        ) : (
          <div className="space-y-2.5">
          {(maxItems ? filteredHistory.slice(0, maxItems) : filteredHistory).map((item, idx) => {
            const isRolledBack = item.status === 'rolled_back';
            const isCompleted = item.status === 'success' || item.status === 'completed';
            const isSession = isHistorySessionEntry(item);
            const dirName = getHistoryEntryName(item);
            
            const actionLabel = isSession ? "继续查看" : getFriendlyStatus(item.status);
            const statusLabel = isSession ? getFriendlyStage(item.status) : getFriendlyStatus(item.status);
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
                className="group cursor-pointer overflow-hidden rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-3 py-2.5 transition-colors hover:border-primary/18 hover:bg-white"
              >
                <div className="flex items-start gap-2.5">
                  <div className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] transition-colors",
                    isRolledBack 
                      ? "bg-surface-container text-on-surface-variant/70" 
                      : isCompleted
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-primary/10 text-primary"
                  )}>
                    {isRolledBack ? <Undo2 className="h-4 w-4" /> : isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate text-[14px] font-semibold text-on-surface transition-colors group-hover:text-primary">
                            {dirName}
                          </h4>
                          <span className={cn(
                            "rounded-[8px] px-2 py-0.5 text-[12px] font-semibold",
                            isRolledBack ? "bg-on-surface/5 text-ui-muted" : "bg-primary/8 text-primary"
                          )}>
                            {statusLabel}
                          </span>
                        </div>
                        <p className="mt-1 truncate pr-1 text-[12px] text-ui-muted" title={item.target_dir}>
                          {item.target_dir}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          requestDelete(item.execution_id);
                        }}
                        className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-1.5 text-ui-muted transition-colors hover:border-error/20 hover:text-error"
                        title="删除记录"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 text-[12px] text-ui-muted">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDisplayDate(item.created_at)}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <FolderOpen className="h-3.5 w-3.5 text-primary/55" />
                          {item.item_count || 0} 项
                        </span>
                        {hasFailures ? (
                          <span className="font-semibold text-error">{item.failure_count} 项失败</span>
                        ) : null}
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-[8px] bg-surface-container px-2 py-1 font-semibold text-primary/80">
                        <span className="hidden 2xl:inline">{actionLabel}</span>
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
          {filteredHistory.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-on-surface/10 bg-surface-container-low/35 px-4 py-8 text-center">
              <p className="text-[14px] font-medium text-ui-muted">没有匹配的记录，试试换个关键词或筛选条件。</p>
            </div>
          ) : null}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(pendingDeleteId)}
        title="删除这条历史记录？"
        description="删除后，这条会话或执行记录将不会再出现在历史列表中，操作无法撤销。"
        confirmLabel="确认删除"
        cancelLabel="取消"
        tone="danger"
        loading={deletingId === pendingDeleteId}
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      />
    </div>
  );
}
