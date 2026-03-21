"use client";

import React, { useEffect, useState } from "react";
import { 
  FolderOpen, FileText, ArrowRight, Activity, 
  History as HistoryIcon, AlertTriangle, Undo2, CheckCircle2,
  Clock, Archive, ChevronRight
} from "lucide-react";
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { getApiBaseUrl } from "@/lib/runtime";
import type { JournalSummary } from "@/types/session";
import { EmptyState } from "@/components/ui/empty-state";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface HistoryEntry {
  execution_id: string;
  target_dir: string;
  status: string;
  created_at: string;
  item_count: number;
}

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [journal, setJournal] = useState<JournalSummary | null>(null);
  const [journalLoading, setJournalLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rollbackSuccess, setRollbackSuccess] = useState(false);

  // Load history list
  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/history`);
      if (!response.ok) throw new Error("无法获取历史记录");
      const data = await response.json();
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
      const response = await fetch(`${getApiBaseUrl()}/api/sessions/${id}/journal`);
      if (!response.ok) throw new Error("无法获取详细记录");
      const data = await response.json();
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
      const response = await fetch(`${getApiBaseUrl()}/api/sessions/${selectedSessionId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true })
      });
      if (!response.ok) throw new Error("回退失败");
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

  return (
    <div className="flex-1 flex overflow-hidden bg-surface">
      {/* --- Left Pane: Execution Logs --- */}
      <section className="w-1/3 min-w-[380px] bg-surface-container-low flex flex-col overflow-hidden border-r border-on-surface/5">
        <div className="p-10 pb-6 space-y-2">
          <h1 className="text-xl font-bold text-on-surface font-headline tracking-tight uppercase tracking-widest">执行历史</h1>
          <p className="text-[10px] text-on-surface-variant font-black uppercase tracking-[0.2em] opacity-40">Deployment Records</p>
        </div>

        <div className="flex-1 overflow-y-auto px-8 space-y-4 pb-12 scrollbar-thin">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center opacity-20">
              <Activity className="w-8 h-8 animate-spin mb-4" />
              <p className="text-[10px] font-bold uppercase tracking-widest">Architecting Logs...</p>
            </div>
          ) : history.length > 0 ? (
            history.map((entry, idx) => (
              <motion.div 
                key={entry.execution_id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}
                onClick={() => setSelectedSessionId(entry.execution_id)}
                className={cn(
                  "p-6 rounded-md transition-all cursor-pointer border group relative overflow-hidden",
                  selectedSessionId === entry.execution_id
                    ? "bg-white border-primary shadow-sm" 
                    : "bg-surface-container-low hover:bg-white border-transparent hover:border-on-surface/10"
                )}
              >
                <div className="flex justify-between items-start mb-4">
                  <span className={cn(
                    "text-[9px] font-black tracking-widest uppercase px-2 py-0.5 rounded",
                    entry.status === 'rolled_back' ? "bg-surface-container-highest text-on-surface-variant/40" : "bg-emerald-500/10 text-emerald-600"
                  )}>
                    {entry.status === 'rolled_back' ? 'RESCINDED' : 'DEPLOYED'}
                  </span>
                  <span className="text-[10px] font-mono text-on-surface-variant/40">
                    {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                
                <h3 className="text-sm font-bold text-on-surface mb-3 line-clamp-1 leading-tight tracking-tight">
                  {entry.target_dir.split(/[\\/]/).pop() || 'Untitled Deployment'}
                </h3>

                <div className="space-y-2 opacity-60">
                  <div className="flex items-center text-[11px] text-on-surface-variant font-mono">
                    <FolderOpen className="w-3 h-3 mr-2 shrink-0" />
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
              <div className="px-10 py-8 flex items-center justify-between border-b border-on-surface/5 bg-white/50 backdrop-blur-md z-10 h-24">
                <div>
                  <h2 className="text-base font-bold text-on-surface font-headline tracking-tight">部署报告预览</h2>
                  <p className="text-[10px] text-on-surface-variant font-mono mt-1 opacity-40">
                    ID: {selectedSessionId}
                  </p>
                </div>
                
                <div className="flex items-center gap-3">
                  {journal.status === 'completed' && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 rounded text-amber-600 border border-amber-500/10">
                       <AlertTriangle className="w-3.5 h-3.5" />
                       <span className="text-[9px] font-black uppercase tracking-widest">Rollback Available</span>
                    </div>
                  )}
                  {journal.status === 'rolled_back' && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-surface-container-highest text-on-surface-variant/40 rounded border border-on-surface/5">
                       <CheckCircle2 className="w-3.5 h-3.5" />
                       <span className="text-[9px] font-black uppercase tracking-widest">Rolled Back</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Content Canvas */}
              <div className="px-10 py-10 overflow-y-auto flex-1 space-y-10 scrollbar-thin">
                
                {rollbackSuccess && (
                  <motion.div initial={{opacity:0, scale:0.95}} animate={{opacity:1, scale:1}} className="p-6 bg-emerald-500/5 border border-emerald-500/10 rounded-md flex items-center gap-6 shadow-sm">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 shrink-0">
                      <Undo2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-on-surface">回退成功</h4>
                      <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">系统已将所有移动记录按原路径还原。受影响的 {journal.item_count} 个节点已回到初始位置。</p>
                    </div>
                  </motion.div>
                )}

                <div className="grid grid-cols-2 gap-4">
                   <div className="bg-surface-container-low p-6 rounded-md border border-on-surface/5">
                      <div className="flex items-center gap-2 mb-2 opacity-40">
                        <Archive className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">迁移总数</span>
                      </div>
                      <p className="text-2xl font-black text-on-surface tabular-nums leading-none tracking-tight">{journal.item_count}</p>
                   </div>
                   <div className="bg-surface-container-low p-6 rounded-md border border-on-surface/5">
                      <div className="flex items-center gap-2 mb-2 opacity-40">
                        <Clock className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">部署用时</span>
                      </div>
                      <p className="text-2xl font-black text-on-surface tabular-nums leading-none tracking-tight">0.8s</p>
                   </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between opacity-40">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em]">架构恢复表</h3>
                  </div>

                  <div className="bg-white border border-on-surface/5 rounded-md overflow-hidden shadow-sm">
                    <table className="w-full text-left font-sans border-collapse">
                      <thead className="bg-surface-container-low/50 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest border-b border-on-surface/5">
                        <tr>
                          <th className="px-6 py-4">Node Title</th>
                          <th className="px-6 py-4">Current → Original Path</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-on-surface/5">
                        {journal.items?.length ? (
                          journal.items.filter(it => it.action_type === 'MOVE').map((it, i) => (
                            <tr key={i} className="hover:bg-surface-container-low transition-colors group">
                              <td className="px-6 py-4">
                                <div className="flex flex-col">
                                  <span className="text-[13px] font-bold text-on-surface">{it.display_name}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3 text-[11px] font-mono text-on-surface-variant/60">
                                   <span className="truncate max-w-[120px]" title={it.target || ""}>{it.target?.split(/[\\/]/).pop() || './'}</span>
                                   <ArrowRight className="w-3 h-3 shrink-0 opacity-20" />
                                   <span className="text-primary font-bold">{it.source?.split(/[\\/]/).pop() || 'Initial'}</span>
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={2} className="px-6 py-12 text-center text-[10px] font-bold text-on-surface-variant/20 uppercase tracking-widest italic">
                              No logical movements recorded
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                
                <div className="h-24" />
              </div>

              {/* Action Bar */}
              {journal.status === 'completed' && !rollbackSuccess && (
                <div className="absolute bottom-10 left-10 right-10 p-5 rounded-md bg-white border border-on-surface/10 shadow-xl flex items-center justify-between animate-in slide-in-from-bottom-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-md bg-warning-container/10 flex items-center justify-center text-warning">
                       <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="space-y-0.5">
                       <p className="text-[11px] font-black uppercase tracking-widest text-on-surface">危险操作区域</p>
                       <p className="text-[10px] text-on-surface-variant italic">回退将完全撤回此部署，无法被二次恢复。</p>
                    </div>
                  </div>
                  <button 
                    onClick={handleRollback}
                    disabled={actionLoading}
                    className="bg-error text-white px-8 py-3 rounded-md text-xs font-bold shadow-lg shadow-error/10 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 group"
                  >
                    {actionLoading ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5 group-hover:-rotate-45 transition-transform" />}
                    物理回退此架构
                  </button>
                </div>
              )}
            </motion.div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center space-y-6">
               <HistoryIcon className="w-16 h-16 text-on-surface/5 stroke-[1px]" />
               <p className="text-[10px] font-black uppercase tracking-[0.3em] text-on-surface-variant/20">Auditing Chamber</p>
            </div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
