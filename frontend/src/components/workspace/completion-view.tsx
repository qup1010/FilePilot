"use client";

import { Folder, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { JournalSummary } from "@/types/session";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface CompletionViewProps {
  journal: JournalSummary | null;
  targetDir: string;
  isBusy: boolean;
  onOpenExplorer: () => void;
  onCleanupDirs: () => void;
  onRollback: () => void;
}

export function CompletionView({ 
  journal, 
  targetDir, 
  isBusy, 
  onOpenExplorer, 
  onCleanupDirs, 
  onRollback 
}: CompletionViewProps) {
  if (!journal) return null;

  const isPartial = journal.failure_count && journal.failure_count > 0;
  const failedItems = journal.items?.filter(it => it.status === 'failed') || [];

  return (
    <div className="space-y-12 animate-in fade-in zoom-in-95 duration-700 max-w-4xl mx-auto py-6">
      {/* Dynamic Status Header */}
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center">
            <div className={cn(
              "w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 duration-500",
              isPartial ? "bg-warning/10 text-warning" : "bg-emerald-500/10 text-emerald-500"
            )}>
              {isPartial ? <AlertTriangle className="w-10 h-10" /> : <CheckCircle2 className="w-10 h-10" />}
            </div>
        </div>
        <div>
          <h2 className={cn(
            "text-2xl font-black font-headline uppercase tracking-widest",
            isPartial ? "text-warning" : "text-emerald-600"
          )}>
            {isPartial ? "部分任务执行受阻" : "方案执行完毕"}
          </h2>
          <p className="text-[10px] text-on-surface-variant font-black uppercase tracking-[0.4em] opacity-40 mt-1">
            {isPartial ? "Partial Success with Conflicts" : "Complete Architectural Transformation"}
          </p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 flex items-center justify-between group transition-all hover:bg-white active:scale-[0.99]">
          <div className="space-y-1">
            <span className="text-[10px] font-black text-emerald-800 uppercase tracking-widest opacity-60 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> 迁移成功
            </span>
            <p className="text-[11px] text-emerald-700/50 font-medium">文件已按预期路径归档</p>
          </div>
          <span className="text-4xl font-black text-emerald-700 tabular-nums">{journal.success_count || 0}</span>
        </div>
        
        <div className={cn(
           "p-6 rounded-2xl border transition-all flex items-center justify-between group hover:bg-white active:scale-[0.99]",
           isPartial ? "bg-red-50 border-red-100" : "bg-surface-container-low/10 border-on-surface/5"
        )}>
          <div className="space-y-1">
            <span className={cn(
              "text-[10px] font-black uppercase tracking-widest flex items-center gap-2",
              isPartial ? "text-red-800 opacity-60" : "text-on-surface-variant/20"
            )}>
              <AlertTriangle className="w-3.5 h-3.5" /> 失败项
            </span>
            <p className="text-[11px] text-on-surface-variant/40 font-medium">因权限或占用导致失败</p>
          </div>
          <span className={cn(
            "text-4xl font-black tabular-nums",
            isPartial ? "text-red-700" : "text-on-surface-variant/10"
          )}>
            {journal.failure_count || 0}
          </span>
        </div>
      </div>

      {/* Failed Items List (if any) */}
      {isPartial && failedItems.length > 0 && (
         <div className="space-y-4">
            <h3 className="text-[10px] font-black text-red-800/40 uppercase tracking-[0.3em] px-1 group flex items-center gap-2">
               <span className="w-4 h-px bg-red-800/10" /> 冲突详情记录 ({failedItems.length})
            </h3>
            <div className="bg-red-50/30 border border-red-100 rounded-xl overflow-hidden shadow-xs divide-y divide-red-100/50">
               {failedItems.slice(0, 10).map((it, i) => (
                  <div key={i} className="px-6 py-4 flex items-center justify-between gap-4 group hover:bg-white transition-colors">
                     <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                        <span className="text-[11px] font-mono text-red-900 truncate font-medium" title={it.display_name}>{it.display_name}</span>
                     </div>
                     <span className="text-[10px] text-red-600/60 font-black uppercase shrink-0">FAIL_MOVE</span>
                  </div>
               ))}
               {failedItems.length > 10 && (
                  <div className="p-3 text-center text-[9px] text-red-800/30 font-bold uppercase tracking-widest italic">
                     ... and {failedItems.length - 10} more conflicts recorded in journal
                  </div>
               )}
            </div>
         </div>
      )}
      
      {/* Post-execution Operations */}
      <div className="space-y-8 pt-6">
        <button 
          className="w-full py-5 bg-on-surface text-surface font-black rounded-2xl shadow-2xl shadow-on-surface/20 hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-4 text-xs uppercase tracking-widest disabled:opacity-50" 
          onClick={onOpenExplorer} 
          disabled={isBusy}
        >
          <Folder className="w-5 h-5" /> 打开归档后的工作空间
        </button>

        <div className="grid grid-cols-2 gap-4">
          <button 
            className="flex flex-col items-center justify-center gap-2 py-6 bg-surface-container-low border border-on-surface/5 rounded-2xl hover:bg-white hover:border-primary/20 transition-all active:scale-95 group disabled:opacity-50" 
            onClick={onCleanupDirs} 
            disabled={isBusy}
          >
            <div className="p-2 rounded-full bg-on-surface/5 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
               <Info className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-on-surface/60 group-hover:text-on-surface">清理残留空目录</span>
          </button>
          
          <button 
            className="flex flex-col items-center justify-center gap-2 py-6 bg-red-50/30 border border-red-100/50 rounded-2xl hover:bg-red-50 hover:border-red-200 transition-all active:scale-95 group disabled:opacity-50" 
            onClick={() => {
              if (window.confirm("回退操作将尝试将所有文件还原至原始位置，确认继续？")) onRollback();
            }} 
            disabled={isBusy}
          >
            <div className="p-2 rounded-full bg-red-800/5 group-hover:bg-red-800/10 group-hover:text-red-700 transition-colors">
               <AlertTriangle className="w-4 h-4 text-red-600/50 group-hover:text-red-600" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-red-800/40 group-hover:text-red-800">撤销并回退架构</span>
          </button>
        </div>
      </div>
    </div>
  );
}
