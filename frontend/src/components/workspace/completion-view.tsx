"use client";

import { AlertTriangle, CheckCircle2, Folder, History, Info, Layers, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { JournalSummary } from "@/types/session";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DirectoryTreeDiff, type DirectoryTreeLeafEntry, type DirectoryTreeFilter } from "./directory-tree-diff";
import { useState } from "react";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface CompletionViewProps {
  journal: JournalSummary | null;
  summary: string;
  loading: boolean;
  targetDir: string;
  isBusy: boolean;
  readOnly?: boolean;
  onOpenExplorer: () => void;
  onCleanupDirs: () => void;
  onRollback: () => void;
}

export function CompletionView({
  journal,
  summary,
  loading,
  targetDir,
  isBusy,
  readOnly = false,
  onOpenExplorer,
  onCleanupDirs,
  onRollback,
}: CompletionViewProps) {
  const [filter, setFilter] = useState<DirectoryTreeFilter>("all");
  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 py-8 animate-pulse">
        <div className="h-36 rounded-[2rem] bg-surface-container-low" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="h-28 rounded-[1.5rem] bg-surface-container-low" />
          <div className="h-28 rounded-[1.5rem] bg-surface-container-low" />
          <div className="h-28 rounded-[1.5rem] bg-surface-container-low" />
        </div>
        <div className="h-[420px] rounded-[2rem] bg-surface-container-low" />
      </div>
    );
  }

  if (!journal) {
    return (
      <div className="rounded-[2rem] border border-on-surface/6 bg-white/70 p-12 text-center shadow-sm">
        <History className="mx-auto mb-4 h-12 w-12 text-on-surface-variant/20" />
        <p className="text-sm font-medium text-on-surface-variant">这里暂时还没有可显示的结果。</p>
      </div>
    );
  }

  const allItems = journal.items || [];
  const moveItems = allItems.filter((item) => item.action_type === "MOVE");
  const mkdirItems = allItems.filter((item) => item.action_type === "MKDIR" && item.target);
  const failedItems = moveItems.filter((item) => item.status === "failed");
  const reviewItems = moveItems.filter((item) =>
    (item.target || "").split(/[\\/]/).some((part) => part.toLowerCase() === "review"),
  );
  const isPartial = (journal.failure_count || 0) > 0;
  const baseLabel = targetDir.split(/[\\/]/).filter(Boolean).at(-1) || "当前目录";

  const beforeTree = {
    title: "整理前目录树",
    subtitle: "执行前参与本次整理的原始文件位置。",
    leafEntries: moveItems
      .filter((item): item is typeof item & { source: string } => Boolean(item.source))
      .map<DirectoryTreeLeafEntry>((item) => ({ path: item.source })),
    basePath: targetDir,
    baseLabel,
    emptyLabel: "当前没有可展示的原始文件结构。",
  };

  const afterTree = {
    title: "整理后目录树",
    subtitle: "执行完成后的目标目录结构，成功、失败与 Review 会在树中直接标出。",
    leafEntries: moveItems
      .filter((item): item is typeof item & { target: string } => Boolean(item.target))
      .map<DirectoryTreeLeafEntry>((item) => ({
        path: item.target,
        status: item.status === "failed"
          ? "failed"
          : item.target.split(/[\\/]/).some((part) => part.toLowerCase() === "review")
            ? "review"
            : "success",
      })),
    directoryEntries: mkdirItems
      .map((item) => item.target)
      .filter((target): target is string => Boolean(target)),
    basePath: targetDir,
    baseLabel,
    emptyLabel: "当前没有可展示的目标目录结构。",
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="rounded-[2.5rem] border border-on-surface/5 bg-white shadow-[0_8px_40px_rgba(0,0,0,0.03)] p-10">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-6 flex-1">
            <div className="space-y-4">
              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-black uppercase tracking-widest",
                  isPartial
                    ? "bg-error/10 text-error animate-pulse"
                    : "bg-emerald-500/10 text-emerald-600",
                )}
              >
                {isPartial ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {isPartial ? "整理已完成 · 有少量问题" : "整理已完成"}
              </div>
              <div>
                <h2 className="text-3xl font-black tracking-tighter text-on-surface">
                  {isPartial ? "整理已完成，请先看看失败项" : "整理已经完成"}
                </h2>
                <div className="mt-6 p-5 rounded-2xl bg-on-surface/[0.02] border border-on-surface/5 relative group/summary">
                  <div className="absolute -top-3 left-4 flex items-center gap-1.5 px-2 bg-white text-[10px] font-black text-primary/40 uppercase tracking-widest">
                    <Sparkles className="w-3 h-3" />
                    <span>这次整理说明</span>
                  </div>
                  <p className="text-[14px] leading-7 text-on-surface-variant italic">
                    {summary || "文件已经按照当前方案整理好了。"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-center lg:items-end gap-3 font-mono">
            <div className="text-[10px] font-black text-on-surface-variant/30 uppercase tracking-[0.2em]">目标目录</div>
            <div className="px-6 py-4 rounded-3xl bg-surface-container-low border border-on-surface/5 shadow-inner">
               <span className="text-[13px] font-bold text-on-surface">{targetDir}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="group rounded-[2rem] border border-emerald-500/10 bg-emerald-500/[0.01] p-6 transition-all hover:bg-emerald-500/[0.03]">
          <div className="flex items-center gap-3 text-emerald-600/60">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-[10px] font-black uppercase tracking-[.2em]">已完成</span>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-4xl font-black text-on-surface tracking-tighter">{journal.success_count || 0}</span>
            <span className="text-xs font-bold text-on-surface-variant/40">项</span>
          </div>
          <div className="mt-6 h-1 w-full bg-emerald-500/5 rounded-full overflow-hidden">
             <div className="h-full bg-emerald-500/40 w-full" />
          </div>
        </div>

        <div className={cn(
          "group rounded-[2rem] border p-6 transition-all",
          isPartial
            ? "border-error/20 bg-error/5 shadow-[0_12px_30px_rgba(239,68,68,0.08)]"
            : "border-on-surface/5 bg-on-surface/[0.01] opacity-50"
        )}>
          <div className={cn("flex items-center gap-3", isPartial ? "text-error" : "text-on-surface-variant/40")}>
            <AlertTriangle className="h-4 w-4" />
            <span className="text-[10px] font-black uppercase tracking-[.2em]">执行失败</span>
          </div>
          <p className={cn("mt-4 text-4xl font-black tracking-tighter", isPartial ? "text-error" : "text-on-surface-variant/40")}>
            {journal.failure_count || 0}
          </p>
          <p className="mt-4 text-[11px] font-medium leading-relaxed text-on-surface-variant/60">
            {isPartial ? "有些文件可能被占用，或当前目录没有写入权限。" : "这次没有遇到执行问题。"}
          </p>
        </div>

        <div className="group rounded-[2rem] border border-primary/10 bg-primary/[0.01] p-6 transition-all hover:bg-primary/[0.03]">
          <div className="flex items-center gap-3 text-primary/60">
            <Layers className="h-4 w-4" />
            <span className="text-[10px] font-black uppercase tracking-[.2em]">Review</span>
          </div>
          <p className="mt-4 text-4xl font-black text-on-surface tracking-tighter">{reviewItems.length}</p>
          <p className="mt-4 text-[11px] font-medium leading-relaxed text-on-surface-variant/60">
            这部分内容是先保留下来的，方便你之后再慢慢确认。
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-end justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-on-surface">目录树前后对比</h3>
            <p className="text-sm text-on-surface-variant">左侧是整理前的位置，右侧是整理后的实际结果。</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-2xl bg-surface-container-low p-1 border border-on-surface/5">
            {[
              { id: "all", label: "全部" },
              { id: "failed", label: "失败" },
              { id: "review", label: "Review" },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setFilter(btn.id as any)}
                className={cn(
                  "px-4 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-xl transition-all",
                  filter === btn.id 
                    ? "bg-white text-primary shadow-sm" 
                    : "text-on-surface-variant/50 hover:text-on-surface"
                )}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
        <DirectoryTreeDiff before={beforeTree} after={afterTree} filter={filter} />
      </div>

      {(failedItems.length > 0 || reviewItems.length > 0) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {failedItems.length > 0 ? (
            <div className={cn("rounded-[1.75rem] border p-6", journal.failure_count && journal.failure_count > 0 ? "border-error/20 bg-error-container/10" : "border-error/12 bg-error-container/5")}>
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-error" />
                <h3 className="text-sm font-bold text-on-surface">未完成的项</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                这些文件通常是因为正在被其他程序占用，或者当前目录没有写入权限。
              </p>
              <div className="mt-4 space-y-2">
                {failedItems.slice(0, 6).map((item) => (
                  <div key={`${item.display_name}-${item.target}`} className="rounded-2xl border border-error/10 bg-white px-4 py-3 text-sm">
                    <p className="font-medium text-on-surface truncate" title={item.display_name}>{item.display_name}</p>
                    <p className="mt-1 text-xs text-on-surface-variant truncate" title={item.target || ""}>
                      目标位置：{item.target || "未知"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {reviewItems.length > 0 ? (
            <div className="rounded-[1.75rem] border border-warning/12 bg-warning-container/10 p-6">
              <div className="flex items-center gap-3">
                <Info className="h-5 w-5 text-warning" />
                <h3 className="text-sm font-bold text-on-surface">Review 说明</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                这部分不是执行失败，而是按策略先放在 `Review` 中，方便你稍后逐项确认。
              </p>
              <div className="mt-4 space-y-2">
                {reviewItems.slice(0, 6).map((item) => (
                  <div key={`${item.display_name}-${item.target}`} className="rounded-2xl border border-warning/10 bg-white px-4 py-3 text-sm">
                    <p className="font-medium text-on-surface truncate" title={item.display_name}>{item.display_name}</p>
                    <p className="mt-1 text-xs text-on-surface-variant truncate" title={item.target || ""}>
                      当前位置：{item.target || "Review"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={cn("flex flex-col gap-4", readOnly ? "md:flex-col" : "md:flex-row md:items-center md:justify-center")}>
        <button
          type="button"
          onClick={onOpenExplorer}
          disabled={isBusy}
          className="order-1 flex items-center justify-center gap-3 rounded-[1.75rem] bg-primary px-8 py-5 text-sm font-black text-white shadow-[0_12px_24px_rgba(var(--primary-rgb),0.2)] transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40"
        >
          <Folder className="h-4 w-4" />
          打开目录
        </button>
        {!readOnly ? (
          <>
            <button
              type="button"
              onClick={onCleanupDirs}
              disabled={isBusy}
              className="order-2 flex items-center justify-center gap-3 rounded-[1.75rem] border border-on-surface/10 bg-white px-6 py-5 text-sm font-bold text-on-surface-variant transition-all hover:bg-surface-container-low hover:text-on-surface disabled:opacity-40"
            >
              <CheckCircle2 className="h-4 w-4 opacity-40" />
              清理空目录
            </button>
            <div className="flex-1 hidden md:block" />
            <button
              type="button"
              onClick={() => {
                if (window.confirm("回退会尝试把这次移动过的文件放回原来的位置，确定继续吗？")) {
                  onRollback();
                }
              }}
              disabled={isBusy}
              className="order-3 flex items-center justify-center gap-3 rounded-[1.75rem] border border-error/20 bg-error/5 px-6 py-5 text-sm font-bold text-error transition-all hover:bg-error/10 disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              整批回退
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
