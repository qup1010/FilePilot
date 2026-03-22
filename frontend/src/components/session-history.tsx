"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  History, 
  FolderOpen, 
  ChevronRight, 
  Activity,
  CheckCircle2,
  Undo2,
  Clock,
  ArrowRight
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl } from "@/lib/runtime";
import type { HistoryItem } from "@/types/session";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function SessionHistory() {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const api = createApiClient(getApiBaseUrl());

  useEffect(() => {
    async function fetchHistory() {
      try {
        const data = await api.getHistory();
        // 只显示最近 4 条
        setHistory(data.slice(0, 4));
      } catch (err) {
        console.error("Failed to fetch history:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, []);

  const handleContinue = (item: HistoryItem) => {
    router.push(`/workspace?session_id=${item.execution_id}&dir=${encodeURIComponent(item.target_dir)}`);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-32 bg-surface-container-low rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-28 bg-surface-container-low rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (history.length === 0) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-1">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
            <History className="w-4 h-4 text-primary" /> 最近的整理活动
          </h3>
          <p className="text-xs text-on-surface-variant font-medium opacity-70">
            快速跳转到过往的整理方案与执行记录
          </p>
        </div>
        <button 
          onClick={() => router.push('/history')}
          className="group flex items-center gap-1.5 text-xs font-medium text-primary hover:opacity-80 transition-all pl-4 py-2"
        >
          查看全部历史记录
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {history.map((item, idx) => {
          const isRolledBack = item.status === 'rolled_back';
          const dirName = item.target_dir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "未命名记录";
          
          return (
            <motion.div
              key={item.execution_id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              onClick={() => handleContinue(item)}
              className="group bg-white/72 border border-outline-variant/10 rounded-[24px] p-5 hover:border-primary/20 transition-all cursor-pointer relative overflow-hidden active:scale-[0.98]"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                    isRolledBack 
                      ? "bg-surface-container-highest text-on-surface-variant/40" 
                      : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white"
                  )}>
                    {isRolledBack ? <Undo2 className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5 transition-transform group-hover:scale-110" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-on-surface tracking-tight truncate max-w-[180px] group-hover:text-primary transition-colors">
                      {dirName}
                    </h4>
                    <div className="flex items-center gap-2 text-[10px] text-on-surface-variant/40 font-mono mt-1">
                      <Clock className="w-3 h-3" />
                      {new Date(item.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                  </div>
                </div>
                
                <div className={cn(
                  "text-[10px] font-medium px-2.5 py-1 rounded-full",
                  isRolledBack 
                    ? "bg-surface-container-highest text-on-surface-variant/40" 
                    : "bg-emerald-500/10 text-emerald-600"
                )}>
                  {isRolledBack ? '已回退' : '已完成'}
                </div>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-on-surface-variant/60 font-medium group-hover:text-on-surface transition-colors">
                 <FolderOpen className="w-3.5 h-3.5 opacity-40 shrink-0 group-hover:opacity-100 group-hover:text-primary" />
                 <span className="truncate">{item.target_dir}</span>
              </div>

              {/* Status Indicator */}
              <div className="absolute top-0 right-0 w-24 h-24 -mr-12 -mt-12 bg-primary/5 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
