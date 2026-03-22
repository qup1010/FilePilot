"use client";

import { 
  Folder, 
  AlertTriangle, 
  CheckCircle2, 
  Info, 
  ChevronRight, 
  History,
  Lightbulb,
  ShieldCheck,
  FileQuestion,
  Search
} from "lucide-react";
import { JournalSummary } from "@/types/session";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion } from "motion/react";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface CompletionViewProps {
  journal: JournalSummary | null;
  loading: boolean;
  targetDir: string;
  isBusy: boolean;
  onOpenExplorer: () => void;
  onCleanupDirs: () => void;
  onRollback: () => void;
}

export function CompletionView({
  journal,
  loading,
  targetDir,
  isBusy,
  onOpenExplorer,
  onCleanupDirs,
  onRollback
}: CompletionViewProps) {
  if (loading) {
    return (
      <div className="space-y-10 max-w-3xl mx-auto py-10 animate-pulse">
        <div className="text-center space-y-6">
          <div className="mx-auto h-24 w-24 rounded-full bg-surface-container-low" />
          <div className="space-y-3">
            <div className="mx-auto h-8 w-64 rounded-lg bg-surface-container-low" />
            <div className="mx-auto h-4 w-48 rounded bg-surface-container-low/60" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="h-32 rounded-3xl bg-surface-container-low" />
          <div className="h-32 rounded-3xl bg-surface-container-low" />
        </div>
        <div className="h-24 rounded-2xl bg-surface-container-low" />
      </div>
    );
  }

  if (!journal) {
    return (
      <div className="rounded-3xl bg-surface-container-lowest p-12 text-center shadow-sm">
        <History className="w-12 h-12 text-on-surface-variant/10 mx-auto mb-4" />
        <p className="text-sm font-medium text-on-surface-variant">当前没有可展示的执行记录</p>
      </div>
    );
  }

  const isPartial = !!(journal.failure_count && journal.failure_count > 0);
  const items = journal.items || [];
  const successItems = items.filter(it => it.status === 'success');
  const failedItems = items.filter(it => it.status === 'failed');

  // 分析整理出的目录结构
  const createdDirs = Array.from(new Set(
    successItems
      .map(it => it.target?.replace(/[\\/][^\\/]+$/, ""))
      .filter(Boolean) as string[]
  )).sort();

  // 分析进入 Review 的文件
  const reviewItems = items.filter(it => 
    it.target?.split(/[\\/]/).some(part => part.toLowerCase() === "review")
  );

  return (
    <div className="space-y-16 animate-in fade-in slide-in-from-bottom-4 duration-1000 max-w-3xl mx-auto py-10">
      {/* 1. Header: The Status Anchor */}
      <div className="text-center space-y-6">
        <div className="flex items-center justify-center">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center shadow-2xl transition-all duration-700",
              isPartial 
                ? "bg-warning/10 text-warning shadow-warning/5" 
                : "bg-emerald-500/10 text-emerald-500 shadow-emerald-500/5"
            )}
          >
            {isPartial ? <AlertTriangle className="w-12 h-12" /> : <ShieldCheck className="w-12 h-12" />}
          </motion.div>
        </div>
        <div>
          <h2 className={cn(
            "text-3xl font-black font-headline tracking-tight leading-none",
            isPartial ? "text-warning" : "text-on-surface"
          )}>
            {isPartial ? "任务执行部分受阻" : "方案已完美落地"}
          </h2>
          <p className="text-[10px] text-on-surface-variant font-black uppercase tracking-[0.5em] opacity-40 mt-3">
            {isPartial ? "Some Tasks Skipped / Check Logs" : "Archive & Structure Optimized"}
          </p>
        </div>
      </div>

      {/* 2. Key Metrics Card */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-surface-container-lowest p-8 rounded-[2rem] border border-emerald-500/10 shadow-sm flex items-center justify-between group transition-all hover:shadow-xl hover:shadow-emerald-500/5">
          <div className="space-y-1">
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> 成功迁移
            </span>
            <p className="text-[40px] font-black text-emerald-600 tabular-nums leading-none tracking-tighter">
              {journal.success_count || 0}
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 opacity-20 group-hover:opacity-100 transition-opacity">
            <Folder className="w-6 h-6" />
          </div>
        </div>

        <div className={cn(
          "p-8 rounded-[2rem] border shadow-sm flex items-center justify-between group transition-all",
          isPartial 
            ? "bg-red-50 border-red-500/10 hover:shadow-xl hover:shadow-red-500/5" 
            : "bg-surface-container-lowest border-outline-variant/10 opacity-40"
        )}>
          <div className="space-y-1">
            <span className={cn(
              "text-[10px] font-black uppercase tracking-widest flex items-center gap-2",
              isPartial ? "text-red-600" : "text-on-surface-variant"
            )}>
              <AlertTriangle className="w-3.5 h-3.5" /> 失败项
            </span>
            <p className={cn(
              "text-[40px] font-black tabular-nums leading-none tracking-tighter",
              isPartial ? "text-red-600" : "text-on-surface-variant"
            )}>
              {journal.failure_count || 0}
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-current flex items-center justify-center opacity-5 group-hover:opacity-10 transition-opacity">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* 3. Results Explanation (User View) */}
      <div className="space-y-8">
        {/* Achievements */}
        <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-[2rem] p-10 space-y-8 shadow-sm">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Lightbulb className="w-5 h-5 text-primary" />
              <h3 className="text-sm font-black font-headline text-on-surface uppercase tracking-widest">整理成果说明</h3>
            </div>
            
            <div className="grid grid-cols-1 gap-6">
              <div className="space-y-3">
                <p className="text-xs font-bold text-on-surface group flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  本次整理构建了以下目录结构：
                </p>
                <div className="flex flex-wrap gap-2 pl-3.5">
                  {createdDirs.length > 0 ? createdDirs.map((dir, idx) => (
                    <span key={idx} className="px-3 py-1.5 bg-surface-container-low rounded-lg text-[11px] font-mono text-on-surface-variant border border-on-surface/5">
                      {dir}
                    </span>
                  )) : <span className="text-[11px] italic text-on-surface-variant/40">未创建新的一级目录</span>}
                </div>
              </div>

              {reviewItems.length > 0 && (
                <div className="space-y-3 pt-2">
                  <p className="text-xs font-bold text-on-surface flex items-center gap-2">
                    <FileQuestion className="w-4 h-4 text-warning" />
                    需人工核对的项 ({reviewItems.length})：
                  </p>
                  <p className="text-[11px] text-on-surface-variant leading-relaxed pl-6 opacity-70">
                    为了保证安全，有 {reviewItems.length} 个文件因语义不明或属于潜在杂质，已被归入 <code className="bg-warning/5 text-warning px-1.5 py-0.5 rounded font-bold">Review</code> 文件夹中。建议您在稍后手动检查这些内容。
                  </p>
                </div>
              )}

              {isPartial && (
                 <div className="space-y-3 pt-2 border-t border-outline-variant/10 pt-6">
                   <p className="text-xs font-bold text-red-800 flex items-center gap-2">
                     <ShieldCheck className="w-4 h-4 text-red-600" />
                     关于失败项的原因：
                   </p>
                   <p className="text-[11px] text-red-900/60 leading-relaxed pl-6">
                     有 {journal.failure_count} 个文件移动失败。这通常是因为这些文件正被其他程序 **占用**，或者当前用户缺乏对部分深层目录的 **写入权限**。这些文件仍保留在原位，未受到任何影响。
                   </p>
                 </div>
              )}
            </div>
          </div>
        </div>

        {/* Detailed Failures if exist */}
        {isPartial && failedItems.length > 0 && (
          <div className="space-y-4">
             <div className="flex items-center gap-3 px-2">
                <Search className="w-3.5 h-3.5 text-red-600/40" />
                <h3 className="text-[10px] font-black text-red-800/40 uppercase tracking-[0.4em]">冲突项列表预览</h3>
             </div>
             <div className="bg-red-500/5 border border-red-500/10 rounded-2xl overflow-hidden divide-y divide-red-500/5">
                {failedItems.slice(0, 5).map((it, i) => (
                  <div key={i} className="px-8 py-4 flex items-center justify-between gap-6 group hover:bg-white transition-colors">
                    <span className="text-[11px] font-mono text-red-900 truncate font-medium">{it.display_name}</span>
                    <span className="text-[9px] font-black text-red-600/30 uppercase tracking-widest shrink-0">LOCKED / PERSMISSION</span>
                  </div>
                ))}
             </div>
          </div>
        )}
      </div>

      {/* 4. Action Layer */}
      <div className="space-y-12">
        <button
          className="w-full py-6 bg-on-surface text-surface-container-lowest font-black rounded-[2rem] shadow-2xl shadow-on-surface/20 hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-4 text-sm uppercase tracking-[0.22em] font-headline disabled:opacity-30"
          onClick={onOpenExplorer}
          disabled={isBusy}
        >
          <Folder className="w-5 h-5" /> 立即打开工作空间
        </button>

        <div className="grid grid-cols-2 gap-6">
          <button
            className="flex flex-col items-center justify-center gap-4 py-8 bg-surface-container-low border border-outline-variant/5 rounded-[2rem] hover:bg-white hover:border-primary/20 transition-all active:scale-95 group disabled:opacity-40"
            onClick={onCleanupDirs}
            disabled={isBusy}
          >
            <div className="w-12 h-12 rounded-2xl bg-on-surface/5 flex items-center justify-center text-on-surface/40 group-hover:bg-primary/10 group-hover:text-primary transition-all">
              <Info className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface group-hover:text-primary transition-colors">清理残留空目录</span>
          </button>

          <button
            className="flex flex-col items-center justify-center gap-4 py-8 bg-red-50/20 border border-red-100/30 rounded-[2rem] hover:bg-red-50 hover:border-red-200 transition-all active:scale-95 group disabled:opacity-40"
            onClick={() => {
              if (window.confirm("回退操作将尝试将所有文件还原至原始位置，确认继续？")) onRollback();
            }}
            disabled={isBusy}
          >
            <div className="w-12 h-12 rounded-2xl bg-red-800/5 flex items-center justify-center text-red-600/40 group-hover:bg-red-800/10 group-hover:text-red-700 transition-all">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-red-800/60 group-hover:text-red-800 transition-colors">物理撤销并回退</span>
          </button>
        </div>
      </div>
    </div>
  );
}
