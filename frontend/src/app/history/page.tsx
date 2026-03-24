"use client";

import React, { useEffect, useState } from "react";
import { 
  FolderOpen, FileText, ArrowRight, Activity, 
  History as HistoryIcon, AlertTriangle, Undo2, CheckCircle2,
  Clock, Archive, ChevronRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

import { getApiBaseUrl } from "@/lib/runtime";
import { createApiClient } from "@/lib/api";
import type { JournalSummary, HistoryItem } from "@/types/session";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [journal, setJournal] = useState<JournalSummary | null>(null);
  const [journalLoading, setJournalLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rollbackSuccess, setRollbackSuccess] = useState(false);
  const api = createApiClient(getApiBaseUrl());

  // Load history list
  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getHistory();
      setHistory(data);
      if (data.length > 0 && !selectedSessionId) {
        setSelectedSessionId(data[0].execution_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }

  // Load specific journal details
  async function loadJournal(id: string) {
    setJournalLoading(true);
    setRollbackSuccess(false);
    try {
      const data = await api.getJournal(id);
      setJournal(data);
    } catch (err) {
      console.error(err);
    } finally {
      setJournalLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      void loadJournal(selectedSessionId);
    }
  }, [selectedSessionId]);

  const handleRollback = async () => {
    if (!journal || !selectedSessionId) return;
    if (!window.confirm("确定要回退这次整理吗？这会将文件物理移动回原始位置。")) return;

    setActionLoading(true);
    try {
      await api.rollback(selectedSessionId, true);
      setRollbackSuccess(true);
      void loadHistory(); // Refresh list
      void loadJournal(selectedSessionId); // Refresh details
    } catch (err) {
      alert(err instanceof Error ? err.message : "回退过程中发生错误");
    } finally {
      setActionLoading(false);
    }
  };

  const formatPath = (path: string) => {
    const segments = path.split(/[\\/]/);
    if (segments.length > 3) {
      return '...' + segments.slice(-3).join('/');
    }
    return path;
  };

  const formatMovePath = (path: string | null, baseDir: string) => {
    if (!path) {
      return "—";
    }

    const normalizedPath = path.replace(/\\/g, "/");
    const normalizedBaseDir = baseDir.replace(/\\/g, "/").replace(/\/$/, "");
    if (normalizedPath.toLowerCase().startsWith(normalizedBaseDir.toLowerCase())) {
      const relative = normalizedPath.slice(normalizedBaseDir.length).replace(/^\/+/, "");
      return relative || ".";
    }
    return formatPath(normalizedPath);
  };

  const moveRows = journal?.restore_items?.length
    ? journal.restore_items
    : journal?.items?.filter(it => it.action_type === "MOVE") ?? [];

  return (
    <div className="flex-1 flex overflow-hidden bg-surface">
      {/* --- Left Pane: Execution Logs --- */}
      <section className="w-1/3 min-w-[380px] bg-surface-container-low flex flex-col overflow-hidden border-r border-on-surface/5">
        <div className="p-10 pb-6 space-y-2">
          <h1 className="text-xl font-bold text-on-surface font-headline tracking-tight uppercase tracking-widest leading-none">执行历史</h1>
          <p className="text-[11px] text-on-surface-variant font-bold uppercase tracking-widest opacity-40">配置您的 AI 整理引擎与服务偏好</p>
        </div>

        <div className="flex-1 overflow-y-auto px-8 space-y-4 pb-12 scrollbar-thin">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center opacity-20">
              <Activity className="w-8 h-8 animate-spin mb-4" />
              <p className="text-[11px] font-black uppercase tracking-widest">正在加载执行记录...</p>
            </div>
          ) : history.length > 0 ? (
            history.map((entry, idx) => (
              <motion.div 
                key={entry.execution_id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}
                onClick={() => setSelectedSessionId(entry.execution_id)}
                className={cn(
                  "p-6 rounded-3xl transition-all cursor-pointer border group relative overflow-hidden",
                  selectedSessionId === entry.execution_id
                    ? "bg-white border-primary shadow-xl shadow-primary/5" 
                    : "bg-white/40 border-on-surface/5 hover:border-primary/20"
                )}
              >
                <div className="flex justify-between items-start mb-4">
                  <span className={cn(
                    "text-[11px] font-black tracking-widest uppercase px-2 py-0.5 rounded",
                    entry.status === 'rolled_back' ? "bg-surface-container-highest text-on-surface-variant/40" : "bg-emerald-500/10 text-emerald-600"
                  )}>
                    {entry.status === 'rolled_back' ? '已回退' : '已执行'}
                  </span>
                  <span className="text-[11px] font-mono text-on-surface-variant/40">
                    {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                
                <h3 className="text-[15px] font-black text-on-surface mb-3 line-clamp-1 leading-tight tracking-tight uppercase">
                  {entry.target_dir.split(/[\\/]/).pop() || '未命名记录'}
                </h3>

                <div className="space-y-2 opacity-60">
                  <div className="flex items-center text-[11px] text-on-surface-variant font-mono">
                    <FolderOpen className="w-3.5 h-3.5 mr-2 shrink-0" />
                    <span className="truncate">{formatPath(entry.target_dir)}</span>
                  </div>
                </div>
              </motion.div>
            ))
          ) : (
            <EmptyState 
              icon={HistoryIcon}
              title="无执行记录"
              description="当您在工作台中完成一次目录重构后，轨迹将在此处持久化。"
              className="py-20 opacity-40"
            />
          )}
        </div>
      </section>

      {/* --- Right Pane: Architectural Details --- */}
      <section className="flex-1 bg-surface flex flex-col overflow-hidden relative">
        <AnimatePresence mode="wait">
          {selectedSessionId && journal ? (
            <motion.div 
              key={selectedSessionId}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="px-10 py-8 flex items-center justify-between border-b border-on-surface/5 bg-white/60 backdrop-blur-2xl z-10 h-24">
                <div className="space-y-1">
                  <h2 className="text-xl font-black text-on-surface font-headline tracking-tight uppercase leading-none">执行报告预览</h2>
                  <p className="text-[11px] text-on-surface-variant font-mono opacity-40">
                    UID: {selectedSessionId}
                  </p>
                </div>
                
                <div className="flex items-center gap-3">
                  {journal.status === 'completed' && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-warning-container/20 rounded-full text-warning border border-warning/10 transition-all">
                       <AlertTriangle className="w-4 h-4" />
                       <span className="text-[11px] font-black uppercase tracking-widest">可物理回退</span>
                    </div>
                  )}
                  {journal.status === 'rolled_back' && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-highest text-on-surface-variant/40 rounded-full border border-on-surface/5">
                       <CheckCircle2 className="w-4 h-4" />
                       <span className="text-[11px] font-black uppercase tracking-widest">已完成回退</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Content Canvas */}
              <div className="px-10 py-10 overflow-y-auto flex-1 space-y-10 scrollbar-thin bg-surface-container-low/20">
                
                {rollbackSuccess && (
                  <motion.div initial={{opacity:0, scale:0.95}} animate={{opacity:1, scale:1}} className="p-8 bg-emerald-500/5 border border-emerald-500/10 rounded-[32px] flex items-center gap-8 shadow-sm">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 shrink-0">
                      <Undo2 className="w-8 h-8" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-[15px] font-black text-on-surface uppercase tracking-tight">回退引擎响应成功</h4>
                      <p className="text-[13px] font-bold text-on-surface-variant/60 leading-relaxed uppercase tracking-widest">
                        系统已将所有移动记录按原路径还原。受影响的 {journal.item_count} 个节点已回到初始位置。
                      </p>
                    </div>
                  </motion.div>
                )}

                <div className="grid grid-cols-2 gap-6">
                   <div className="bg-white p-8 rounded-[32px] border border-on-surface/5 shadow-sm">
                      <div className="flex items-center gap-2 mb-4 opacity-40">
                        <Archive className="w-4 h-4" />
                        <span className="text-[11px] font-black uppercase tracking-[0.3em]">迁移总数</span>
                      </div>
                      <p className="text-4xl font-black text-on-surface tabular-nums tracking-tighter">{journal.item_count}</p>
                   </div>
                   <div className="bg-white p-8 rounded-[32px] border border-on-surface/5 shadow-sm">
                      <div className="flex items-center gap-2 mb-4 opacity-40">
                        <Clock className="w-4 h-4" />
                        <span className="text-[11px] font-black uppercase tracking-[0.3em]">引擎执行时耗</span>
                      </div>
                      <p className="text-4xl font-black text-on-surface tabular-nums tracking-tighter">0.8s</p>
                   </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between px-2">
                    <h3 className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.3em]">物理路径恢复索引表</h3>
                  </div>

                  <div className="bg-white border border-on-surface/5 rounded-[40px] overflow-hidden shadow-xl shadow-on-surface/5">
                    <table className="w-full text-left font-sans border-collapse">
                      <thead className="bg-surface-container-low/50 text-[11px] font-black text-on-surface-variant border-b border-on-surface/5 uppercase tracking-[0.2em]">
                        <tr>
                          <th className="px-8 py-5">资源标识符</th>
                          <th className="px-8 py-5">物理路径演变轨迹 (Current → Source)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-on-surface/5">
                        {moveRows.length ? (
                          moveRows.map((it, i) => (
                            <tr key={i} className="hover:bg-surface-container-low/40 transition-colors group">
                              <td className="px-8 py-6">
                                <div className="flex flex-col">
                                  <span className="text-[14px] font-black text-on-surface tracking-tight uppercase">{it.display_name}</span>
                                </div>
                              </td>
                              <td className="px-8 py-6">
                                <div className="flex items-center gap-4 text-[12px] font-bold text-on-surface-variant/60 font-mono">
                                   <span
                                     className="min-w-0 truncate text-on-surface-variant leading-6 opacity-60"
                                     title={it.target || ""}
                                   >
                                     {formatMovePath(it.target, journal.target_dir)}
                                   </span>
                                   <ArrowRight className="w-3.5 h-3.5 shrink-0 opacity-20" />
                                   <span
                                     className="min-w-0 truncate text-primary font-black leading-6"
                                     title={it.source || ""}
                                   >
                                     {formatMovePath(it.source, journal.target_dir)}
                                   </span>
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={2} className="px-8 py-16 text-center text-[13px] font-bold text-on-surface-variant/30 uppercase tracking-widest italic">
                              NO TRACE DATA AVAILABLE
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                
                <div className="h-32" />
              </div>

              {/* Action Bar */}
              {journal.status === 'completed' && !rollbackSuccess && (
                <div className="absolute bottom-10 left-10 right-10 p-6 rounded-[32px] bg-white border border-on-surface/10 shadow-2xl flex items-center justify-between animate-in slide-in-from-bottom-8 backdrop-blur-xl">
                  <div className="flex items-center gap-6">
                    <div className="w-12 h-12 rounded-2xl bg-error/10 flex items-center justify-center text-error shadow-sm">
                       <AlertTriangle className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                       <p className="text-[13px] font-black uppercase tracking-widest text-on-surface">危险操作区域：架构回退</p>
                       <p className="text-[11px] font-bold text-on-surface-variant/40 uppercase tracking-widest italic">回退将完全撤回此部署，无法被二次恢复。</p>
                    </div>
                  </div>
                  <Button 
                    variant="danger"
                    onClick={handleRollback}
                    disabled={actionLoading}
                    loading={actionLoading}
                    className="px-10 py-5 h-auto text-sm"
                  >
                    物理回退此架构
                  </Button>
                </div>
              )}
            </motion.div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center space-y-8 bg-surface-container-low/10">
               <div className="w-24 h-24 rounded-[40px] bg-white border border-on-surface/5 flex items-center justify-center text-on-surface-variant/10 shadow-sm">
                 <HistoryIcon className="w-10 h-10 stroke-[1.5px]" />
               </div>
               <p className="text-[13px] font-black text-on-surface-variant/20 uppercase tracking-[0.4em]">请选择一条执行记录查看详情</p>
            </div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
