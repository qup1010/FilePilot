"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { 
  FolderOpen, 
  Activity,
  CheckCircle2,
  Layers,
  Undo2,
  Clock,
  ArrowRight,
  History as HistoryIcon,
  Search,
  Filter,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createApiClient } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { HistoryItem } from "@/types/session";
import { cn, getFriendlyStatus, formatDisplayDate, getFriendlyStage } from "@/lib/utils";

export function SessionHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed" | "rolled_back">("all");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();
  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);

  useEffect(() => {
    api.getHistory().then(setHistory).catch(err => console.error("Failed to fetch history:", err));
  }, []);

  const handleContinue = (item: HistoryItem) => {
    if (item.status === 'success' || item.status === 'completed' || item.status === 'rolled_back') {
      router.push(`/workspace?execution_id=${item.execution_id}`);
    } else {
      router.push(`/workspace?session_id=${item.execution_id}`);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) {
      return;
    }
    setDeletingId(pendingDeleteId);
    try {
      await api.deleteHistoryEntry(pendingDeleteId);
      setHistory((prev) => prev.filter((item) => item.execution_id !== pendingDeleteId));
      setPendingDeleteId(null);
    } catch (err) {
      console.error("Failed to delete history entry:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const filteredHistory = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return history.filter((item) => {
      const isSession = item.is_session || !["success", "completed", "rolled_back", "partial_failure"].includes(item.status);
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "active"
            ? isSession
            : filter === "completed"
              ? !isSession && item.status !== "rolled_back"
              : item.status === "rolled_back";

      if (!matchesFilter) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const dirName = item.target_dir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "";
      return [item.target_dir, dirName, item.status, item.execution_id].some((value) =>
        value.toLowerCase().includes(keyword),
      );
    });
  }, [filter, history, query]);

  if (history.length === 0) return null;

  return (
    <div className="space-y-4 rounded-[28px] border border-on-surface/8 bg-white/62 p-4 shadow-[0_18px_50px_rgba(36,48,42,0.06)] backdrop-blur-xl lg:p-5">
      <div className="flex items-center justify-between gap-4 px-1">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-base font-black text-on-surface flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
              <HistoryIcon className="w-3.5 h-3.5 text-primary" />
            </div>
            最近的整理记录
          </h3>
          <p className="text-ui-meta font-medium">
            方便回看之前的方案和结果
          </p>
        </div>
        <button 
          onClick={() => router.push('/history')}
          className="group flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface-container-low border border-on-surface/5 text-[12px] font-semibold text-primary hover:bg-white hover:shadow-sm transition-all shrink-0"
        >
          查看全部记录
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索目录、状态或记录 ID"
            className="w-full rounded-2xl border border-on-surface/8 bg-white/88 py-3 pl-11 pr-4 text-[14px] text-on-surface outline-none transition-all placeholder:text-ui-muted focus:border-primary/30 focus:ring-4 focus:ring-primary/5"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-surface-container-low px-3 py-1.5 text-ui-meta font-medium text-ui-muted">
            <Filter className="h-3.5 w-3.5" />
            快速筛选
          </div>
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
                "rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
                filter === item.id
                  ? "border-primary bg-primary text-white"
                  : "border-on-surface/8 bg-white text-ui-muted hover:text-on-surface",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {filteredHistory.slice(0, 6).map((item, idx) => {
          const isRolledBack = item.status === 'rolled_back';
          const isCompleted = item.status === 'success' || item.status === 'completed';
          const isSession = item.is_session || !['success', 'completed', 'rolled_back', 'partial_failure'].includes(item.status);
          const dirName = item.target_dir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "未命名记录";
          
          const actionLabel = isSession ? "继续查看" : getFriendlyStatus(item.status);
          const statusLabel = isSession ? getFriendlyStage(item.status) : (item.status?.toUpperCase() || "UNKNOWN");
          const hasFailures = (item.failure_count || 0) > 0;

          return (
            <motion.div
              key={item.execution_id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              onClick={() => handleContinue(item)}
              className="group bg-white/72 backdrop-blur-md border border-on-surface/5 rounded-[24px] p-4 hover:border-primary/30 hover:bg-white transition-all cursor-pointer relative overflow-hidden active:scale-[0.98] shadow-sm hover:shadow-xl hover:shadow-primary/5"
            >
                <div className="flex items-start justify-between mb-4 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-500 shrink-0",
                    isRolledBack 
                      ? "bg-surface-container-highest text-on-surface-variant/30" 
                      : isCompleted
                        ? "bg-emerald-500/10 text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white"
                        : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white"
                  )}>
                    {isRolledBack ? <Undo2 className="w-5 h-5" /> : isCompleted ? <CheckCircle2 className="w-5 h-5" /> : <Activity className="w-5 h-5 animate-pulse" />}
                  </div>
                  <div className="space-y-1 min-w-0">
                    <h4 className="text-[14px] font-black text-on-surface tracking-tight truncate max-w-[180px] group-hover:text-primary transition-colors">
                      {dirName}
                    </h4>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className={cn(
                        "text-[12px] font-semibold px-1.5 py-0.5 rounded",
                        isRolledBack ? "bg-on-surface/5 text-ui-muted" : "bg-primary/5 text-primary/80"
                      )}>
                        {statusLabel}
                      </span>
                      <div className="flex items-center gap-1.5 text-ui-meta font-medium">
                        <Clock className="w-3 h-3" />
                        {formatDisplayDate(item.created_at)}
                      </div>
                    </div>
                  </div>
                  </div>
                
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingDeleteId(item.execution_id);
                      }}
                      className="rounded-full border border-on-surface/8 bg-white/80 p-2 text-ui-muted transition-colors hover:border-error/20 hover:text-error"
                      title="删除记录"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <div className={cn(
                      "text-[12px] font-semibold px-3 py-1.5 rounded-full border transition-colors",
                      isRolledBack 
                        ? "border-on-surface/5 text-ui-muted" 
                        : isSession
                          ? "border-primary bg-primary text-white shadow-lg shadow-primary/20"
                          : isCompleted
                            ? "border-emerald-500/10 bg-emerald-500/5 text-emerald-600 group-hover:bg-emerald-500/10"
                            : "border-primary/10 bg-primary/5 text-primary group-hover:bg-primary/10"
                    )}>
                      {actionLabel}
                    </div>
                  </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-ui-meta text-ui-muted font-medium tracking-tight bg-surface-container-low/40 rounded-xl px-3 py-2 border border-on-surface/5 transition-colors group-hover:bg-surface-container-low/60 group-hover:text-on-surface">
                   <FolderOpen className="w-3.5 h-3.5 text-primary/30 shrink-0 group-hover:text-primary/60" />
                   <span className="truncate opacity-80">{item.target_dir}</span>
                </div>
                
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1 text-ui-meta font-medium text-ui-muted">
                    <Layers className="w-3 h-3" />
                    涉及 {item.item_count || 0} 项
                    {hasFailures && (
                      <span className="ml-2 text-error font-black">
                        / {item.failure_count} 项失败
                      </span>
                    )}
                  </div>
                  <ArrowRight className="w-4 h-4 text-primary opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                </div>
              </div>

              {/* Status Indicator Background Effect */}
              <div className={cn(
                "absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-3xl opacity-0 group-hover:opacity-20 transition-opacity duration-700",
                isRolledBack ? "bg-on-surface" : isCompleted ? "bg-emerald-500" : "bg-primary"
              )} />
            </motion.div>
          );
        })}
      </div>
      {filteredHistory.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-on-surface/10 bg-surface-container-low/35 px-4 py-10 text-center">
          <p className="text-[14px] font-medium text-ui-muted">没有匹配的记录，试试换个关键词或筛选条件。</p>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingDeleteId)}
        title="删除这条历史记录？"
        description="删除后，这条会话或执行记录将不会再出现在历史列表中，操作无法撤销。"
        confirmLabel="确认删除"
        cancelLabel="取消"
        tone="danger"
        loading={deletingId === pendingDeleteId}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
