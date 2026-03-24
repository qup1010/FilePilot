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
  History as HistoryIcon
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { HistoryItem } from "@/types/session";
import { cn, getFriendlyStatus, formatDisplayDate, getFriendlyStage } from "@/lib/utils";

export function SessionHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
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

  if (history.length === 0) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-base font-black text-on-surface flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
              <HistoryIcon className="w-3.5 h-3.5 text-primary" />
            </div>
            最近的整理活动
          </h3>
          <p className="text-[11px] text-on-surface-variant font-bold uppercase tracking-widest opacity-40">
            快速跳转到过往的整理方案与执行记录
          </p>
        </div>
        <button 
          onClick={() => router.push('/history')}
          className="group flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container-low border border-on-surface/5 text-[11px] font-black uppercase tracking-wider text-primary hover:bg-white hover:shadow-sm transition-all"
        >
          查看全部历史
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {history.map((item, idx) => {
          const isRolledBack = item.status === 'rolled_back';
          const isCompleted = item.status === 'success' || item.status === 'completed';
          const isSession = item.is_session || !['success', 'completed', 'rolled_back', 'partial_failure'].includes(item.status);
          const dirName = item.target_dir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "未命名记录";
          
          const actionLabel = isSession ? "可以继续" : getFriendlyStatus(item.status);
          const statusLabel = isSession ? getFriendlyStage(item.status) : (item.status?.toUpperCase() || "UNKNOWN");
          const hasFailures = (item.failure_count || 0) > 0;

          return (
            <motion.div
              key={item.execution_id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              onClick={() => handleContinue(item)}
              className="group bg-white/60 backdrop-blur-md border border-on-surface/5 rounded-[28px] p-6 hover:border-primary/30 hover:bg-white transition-all cursor-pointer relative overflow-hidden active:scale-[0.98] shadow-sm hover:shadow-xl hover:shadow-primary/5"
            >
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500",
                    isRolledBack 
                      ? "bg-surface-container-highest text-on-surface-variant/30" 
                      : isCompleted
                        ? "bg-emerald-500/10 text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white"
                        : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white"
                  )}>
                    {isRolledBack ? <Undo2 className="w-5 h-5" /> : isCompleted ? <CheckCircle2 className="w-5 h-5" /> : <Activity className="w-5 h-5 animate-pulse" />}
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-[15px] font-black text-on-surface tracking-tight truncate max-w-[160px] group-hover:text-primary transition-colors">
                      {dirName}
                    </h4>
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded",
                        isRolledBack ? "bg-on-surface/5 text-on-surface-variant/40" : "bg-primary/5 text-primary/60"
                      )}>
                        {statusLabel}
                      </span>
                      <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/40 font-bold uppercase tracking-tighter">
                        <Clock className="w-3 h-3" />
                        {formatDisplayDate(item.created_at)}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className={cn(
                  "text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border transition-colors",
                  isRolledBack 
                    ? "border-on-surface/5 text-on-surface-variant/30" 
                    : isSession
                      ? "border-primary bg-primary text-white shadow-lg shadow-primary/20"
                      : isCompleted
                        ? "border-emerald-500/10 bg-emerald-500/5 text-emerald-600 group-hover:bg-emerald-500/10"
                        : "border-primary/10 bg-primary/5 text-primary group-hover:bg-primary/10"
                )}>
                  {actionLabel}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[11px] text-on-surface-variant/60 font-bold tracking-tight bg-surface-container-low/40 rounded-xl px-3 py-2 border border-on-surface/5 transition-colors group-hover:bg-surface-container-low/60 group-hover:text-on-surface">
                   <FolderOpen className="w-3.5 h-3.5 text-primary/30 shrink-0 group-hover:text-primary/60" />
                   <span className="truncate opacity-80">{item.target_dir}</span>
                </div>
                
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1 text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.1em]">
                    <Layers className="w-3 h-3" />
                    涉及 {item.item_count || 0} 个文件
                    {hasFailures && (
                      <span className="ml-2 text-error font-black">
                        / {item.failure_count} 个失败
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
    </div>
  );
}
