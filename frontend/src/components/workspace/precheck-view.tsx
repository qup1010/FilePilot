"use client";

import { AlertCircle, CheckCircle2, ListChecks, ArrowRight, FolderPlus, Info } from "lucide-react";
import { PrecheckSummary } from "@/types/session";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PrecheckViewProps {
  summary: PrecheckSummary | null;
  isBusy: boolean;
  onExecute: (confirm: boolean) => void;
  onBack: () => void;
}

export function PrecheckView({ summary, isBusy, onExecute, onBack }: PrecheckViewProps) {
  if (!summary) return null;

  const hasErrors = summary.blocking_errors.length > 0;
  const hasWarnings = summary.warnings.length > 0;

  return (
    <div className="space-y-10 animate-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-on-surface/5 pb-6">
        <div className="space-y-1">
          <h2 className="text-xl font-black font-headline text-on-surface tracking-tight uppercase tracking-widest leading-none">执行预检汇报</h2>
          <p className="text-[10px] text-on-surface-variant font-black uppercase tracking-[0.2em] opacity-40 mt-1">Ready for File Transformation</p>
        </div>
        {!hasErrors && (
          <div className="px-3 py-1 bg-emerald-500/10 text-emerald-600 rounded text-[10px] font-black tracking-widest flex items-center gap-1.5 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            PASS
          </div>
        )}
      </div>

      {/* Constraints */}
      {(hasErrors || hasWarnings) && (
        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-on-surface-variant/40 uppercase tracking-[0.3em] flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" /> 约束与风险
          </h3>
          <div className="space-y-2">
            {summary.blocking_errors.map((err, i) => (
              <div key={i} className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-md text-xs text-red-800 animate-in fade-in slide-in-from-left-2 transition-all">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="font-bold">{err}</p>
              </div>
            ))}
            {summary.warnings.map((warn, i) => (
              <div key={i} className="flex items-start gap-3 p-4 bg-warning-container/30 border border-warning/10 rounded-md text-xs text-warning animate-in fade-in slide-in-from-left-2 transition-all">
                <Info className="w-4 h-4 shrink-0 mt-0.5 opacity-60" />
                <p className="font-medium">{warn}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Directory Creation Preview */}
      {summary.mkdir_preview.length > 0 && (
         <div className="space-y-4">
            <h3 className="text-[10px] font-black text-on-surface-variant/40 uppercase tracking-[0.3em] flex items-center gap-2">
              <FolderPlus className="w-3.5 h-3.5" /> 将创建的新目录 ({summary.mkdir_preview.length})
            </h3>
            <div className="flex flex-wrap gap-2">
               {summary.mkdir_preview.map((dir, i) => (
                 <span key={i} className="px-3 py-1.5 bg-surface-container-low border border-on-surface/5 rounded-md text-[11px] font-mono text-on-surface-variant">
                    {dir}
                 </span>
               ))}
            </div>
         </div>
      )}

      {/* Move Operations Preview */}
      <div className="space-y-4">
        <h3 className="text-[10px] font-black text-on-surface-variant/40 uppercase tracking-[0.3em] flex items-center gap-2">
          <ArrowRight className="w-3.5 h-3.5" /> 文件迁移预览 ({summary.move_preview.length})
        </h3>
        <div className="bg-surface-container-low/30 border border-on-surface/5 rounded-xl overflow-hidden shadow-xs">
          <div className="grid grid-cols-2 bg-on-surface/5 px-6 py-3 border-b border-on-surface/5">
             <span className="text-[9px] font-black text-on-surface-variant uppercase tracking-widest opacity-40">源路径 (Source)</span>
             <span className="text-[9px] font-black text-on-surface-variant uppercase tracking-widest opacity-40">目标路径 (Target)</span>
          </div>
          <div className="max-h-[320px] overflow-y-auto divide-y divide-on-surface/5 scrollbar-thin">
            {summary.move_preview.map((move, i) => (
              <div key={i} className="grid grid-cols-2 px-6 py-4 items-center gap-8 hover:bg-white transition-colors group">
                <div className="text-[11px] font-mono text-on-surface-variant truncate pr-4 group-hover:text-on-surface transition-colors" title={move.source}>
                  {move.source}
                </div>
                <div className="flex items-center gap-3 overflow-hidden">
                  <ArrowRight className="w-3 h-3 shrink-0 text-primary opacity-20 group-hover:opacity-100 transition-opacity" />
                  <div className="text-[11px] font-mono font-bold text-primary truncate" title={move.target}>
                    {move.target}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="pt-10 flex items-center gap-4">
        <button 
          onClick={onBack}
          disabled={isBusy}
          className="px-8 py-3.5 bg-surface-container-highest text-on-surface text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-on-surface hover:text-white transition-all disabled:opacity-50 active:scale-95"
        >
          返回修改方案
        </button>
        <button 
          onClick={() => onExecute(true)}
          disabled={isBusy || hasErrors}
          className={cn(
            "flex-1 py-4 bg-primary text-white font-black rounded-lg shadow-xl shadow-primary/20 hover:opacity-95 active:scale-[0.98] transition-all flex items-center justify-center gap-3 text-xs uppercase tracking-widest disabled:opacity-20 disabled:grayscale",
          )}
        >
          {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
          确认并开始批量迁移
        </button>
      </div>
    </div>
  );
}

function RefreshCw(props: any) {
  return (
    <svg 
      {...props} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
      <path d="M21 3v5h-5"/>
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
      <path d="M3 21v-5h5"/>
    </svg>
  );
}
