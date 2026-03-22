"use client";

import { AlertCircle, CheckCircle2, ListChecks, ArrowRight, FolderPlus, Info, HelpCircle, ShieldAlert, FileSearch } from "lucide-react";
import { PrecheckSummary } from "@/types/session";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion } from "motion/react";

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

  // 计算进入 Review 的项
  const reviewCount = summary.move_preview.filter(m => 
    m.target.split(/[\\/]/).some(part => part.toLowerCase() === "review")
  ).length;

  return (
    <div className="space-y-12 animate-in slide-in-from-bottom-4 duration-700 max-w-4xl mx-auto py-6">
      {/* 1. Header & Verdict */}
      <div className="flex items-end justify-between border-b border-on-surface/5 pb-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-black font-headline text-on-surface tracking-tight uppercase tracking-widest leading-none">执行最终确认</h2>
          <p className="text-[11px] text-on-surface-variant font-bold uppercase tracking-[0.3em] opacity-40">Final Architectural Pre-flight Check</p>
        </div>
        <div className={cn(
          "px-4 py-2 rounded-xl text-[11px] font-black tracking-[0.2em] flex items-center gap-2 border shadow-sm",
          hasErrors 
            ? "bg-red-500/10 text-red-600 border-red-500/20" 
            : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
        )}>
          {hasErrors ? (
            <><ShieldAlert className="w-4 h-4" /> REJECTED</>
          ) : (
            <><CheckCircle2 className="w-4 h-4" /> VERIFIED</>
          )}
        </div>
      </div>

      {/* 2. User-Centric Impact Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-5 rounded-2xl border border-outline-variant/5 shadow-sm space-y-3 transition-transform hover:scale-[1.02]">
           <div className="w-8 h-8 rounded-lg bg-primary/5 text-primary flex items-center justify-center">
             <FolderPlus className="w-4 h-4" />
           </div>
           <div>
             <span className="block text-2xl font-black text-on-surface leading-none">{summary.mkdir_preview.length}</span>
             <span className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-widest mt-1">新建目录数</span>
           </div>
        </div>
        
        <div className="bg-surface-container-lowest p-5 rounded-2xl border border-outline-variant/5 shadow-sm space-y-3 transition-transform hover:scale-[1.02]">
           <div className="w-8 h-8 rounded-lg bg-emerald-500/5 text-emerald-600 flex items-center justify-center">
             <ArrowRight className="w-4 h-4" />
           </div>
           <div>
             <span className="block text-2xl font-black text-on-surface leading-none">{summary.move_preview.length}</span>
             <span className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-widest mt-1">计划移动文件</span>
           </div>
        </div>

        <div className="bg-surface-container-lowest p-5 rounded-2xl border border-outline-variant/5 shadow-sm space-y-3 transition-transform hover:scale-[1.02]">
           <div className="w-8 h-8 rounded-lg bg-warning/5 text-warning flex items-center justify-center">
             <HelpCircle className="w-4 h-4" />
           </div>
           <div>
             <span className="block text-2xl font-black text-on-surface leading-none">{reviewCount}</span>
             <span className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-widest mt-1">进入 Review 库</span>
           </div>
        </div>

        <div className={cn(
          "p-5 rounded-2xl border shadow-sm space-y-3 transition-transform hover:scale-[1.02]",
          hasErrors ? "bg-red-500/5 border-red-100" : "bg-surface-container-lowest border-outline-variant/5"
        )}>
           <div className={cn(
             "w-8 h-8 rounded-lg flex items-center justify-center",
             hasErrors ? "bg-red-500/10 text-red-600" : "bg-outline-variant/10 text-on-surface-variant/40"
           )}>
             <FileSearch className="w-4 h-4" />
           </div>
           <div>
             <span className={cn("block text-2xl font-black leading-none", hasErrors ? "text-red-600" : "text-on-surface")}>
               {summary.blocking_errors.length + summary.warnings.length}
             </span>
             <span className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-widest mt-1">潜在风险提醒</span>
           </div>
        </div>
      </div>

      {/* 3. Risk Detail & Policy */}
      {(hasErrors || hasWarnings) && (
        <div className="bg-surface-container-low/50 rounded-2xl p-8 space-y-6">
          <div className="flex items-center gap-3">
             <ShieldAlert className="w-5 h-5 text-on-surface/30" />
             <h3 className="text-[10px] font-black text-on-surface-variant/60 uppercase tracking-[0.4em]">冲突与安全性评估</h3>
          </div>
          <div className="space-y-3">
            {summary.blocking_errors.map((err, i) => (
              <div key={i} className="flex items-start gap-4 p-5 bg-white border-l-4 border-red-500 rounded-r-xl shadow-sm animate-in fade-in slide-in-from-left-2">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-on-surface">阻塞性冲突：文件可能无法正确写入</p>
                  <p className="text-[11px] text-on-surface-variant leading-relaxed">{err}</p>
                </div>
              </div>
            ))}
            {summary.warnings.map((warn, i) => (
              <div key={i} className="flex items-start gap-4 p-5 bg-white border-l-4 border-warning rounded-r-xl shadow-sm animate-in fade-in slide-in-from-left-2 transition-all">
                <Info className="w-5 h-5 text-warning shrink-0 mt-0.5 opacity-60" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-on-surface">路径覆盖风险：可能覆盖已有文件</p>
                  <p className="text-[11px] text-on-surface-variant leading-relaxed">{warn}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Action Confirmation */}
      <div className="flex flex-col gap-6 pt-6">
        <div className="bg-primary/5 p-6 rounded-2xl flex items-center gap-6 border border-primary/10">
           <div className="w-12 h-12 rounded-xl bg-primary text-white flex items-center justify-center shrink-0">
             <ListChecks className="w-6 h-6" />
           </div>
           <div className="space-y-1">
              <h4 className="text-sm font-bold text-on-surface">确认执行批量架构调整？</h4>
              <p className="text-xs text-on-surface-variant opacity-60">此操作将物理移动您的本地文件。若结果不理想，可以在执行后进行整体回退。</p>
           </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            disabled={isBusy}
            className="px-10 py-5 bg-surface-container-highest text-on-surface text-[11px] font-black uppercase tracking-widest rounded-2xl hover:bg-on-surface hover:text-white transition-all disabled:opacity-30 active:scale-95 shadow-sm"
          >
            返回上一阶段
          </button>
          <button 
            onClick={() => onExecute(true)}
            disabled={isBusy || hasErrors}
            className={cn(
              "flex-1 py-5 bg-primary text-white font-black rounded-2xl shadow-2xl shadow-primary/20 hover:opacity-95 active:scale-[0.98] transition-all flex items-center gap-4 justify-center text-xs uppercase tracking-[0.2em] font-headline disabled:opacity-20 disabled:grayscale",
            )}
          >
            {isBusy ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
            确认执行重构
          </button>
        </div>
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
