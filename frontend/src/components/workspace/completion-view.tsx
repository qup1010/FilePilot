"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, Folder, History, Info, Layers, Loader2, Palette, RotateCcw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrganizeMethod, JournalSummary } from "@/types/session";
import { DirectoryTreeDiff, type DirectoryTreeLeafEntry, type DirectoryTreeFilter } from "./directory-tree-diff";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FileRadarIllustration } from "@/components/ui/svg-illustrations";


interface CompletionViewProps {
  journal: JournalSummary | null;
  summary: string;
  loading: boolean;
  loadError?: string | null;
  targetDir: string;
  organizeMethod?: OrganizeMethod;
  cleanupCandidateCount?: number;
  isBusy: boolean;
  readOnly?: boolean;
  rollbackPreparing?: boolean;
  onRetryLoad?: () => void;
  onOpenExplorer: (path?: string) => void;
  onCleanupDirs: () => void;
  onRollback: () => void;
  onGoHome: () => void;
}

function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

type JournalMoveItem = NonNullable<JournalSummary["items"]>[number];

function hasReviewPathSegment(path: string | null | undefined): boolean {
  return String(path || "").split(/[\\/]/).some((part) => part.toLowerCase() === "review");
}

function isReviewJournalItem(item: JournalMoveItem): boolean {
  return Boolean(item.is_review)
    || String(item.target_kind || "").toLowerCase() === "review"
    || item.target_slot_id === "Review"
    || hasReviewPathSegment(item.target);
}

export function CompletionView({
  journal,
  summary,
  loading,
  loadError = null,
  targetDir,
  organizeMethod,
  cleanupCandidateCount = 0,
  isBusy,
  readOnly = false,
  rollbackPreparing = false,
  onRetryLoad,
  onOpenExplorer,
  onCleanupDirs,
  onRollback,
  onGoHome,
}: CompletionViewProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<DirectoryTreeFilter>("all");
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);

  if (!journal && loadError) {
    return (
      <div className="mx-auto flex min-h-[360px] max-w-[720px] flex-col items-center justify-center gap-4 rounded-lg border border-error/15 bg-error/[0.02] p-12 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-error/10 text-error">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <p className="text-[14px] font-black text-on-surface">读取执行记录失败</p>
          <p className="text-[12px] font-medium text-on-surface-variant">{loadError}</p>
        </div>
        <div className="flex items-center gap-3">
          {onRetryLoad ? (
            <button
              type="button"
              onClick={onRetryLoad}
              className="rounded-[8px] bg-primary px-4 py-2 text-[12px] font-bold text-white transition-opacity hover:opacity-90"
            >
              重试读取
            </button>
          ) : null}
          <button
            type="button"
            onClick={onGoHome}
            className="rounded-[8px] border border-on-surface/10 bg-surface px-4 py-2 text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-on-surface/5"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-[1360px] animate-pulse space-y-4 py-5">
        <div className="h-24 rounded-lg bg-surface-container-low" />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="h-20 rounded-[8px] bg-surface-container-low" />
          <div className="h-20 rounded-[8px] bg-surface-container-low" />
          <div className="h-20 rounded-[8px] bg-surface-container-low" />
          <div className="h-20 rounded-[8px] bg-surface-container-low" />
        </div>
        <div className="h-[420px] rounded-lg bg-surface-container-low" />
      </div>
    );
  }

  if (!journal) {
    return (
      <div className="rounded-lg border border-on-surface/12 bg-surface-container-lowest p-12 text-center flex flex-col items-center justify-center min-h-[360px]">
        <FileRadarIllustration className="w-40 h-40 mb-4 opacity-75" />
        <p className="text-sm font-medium text-on-surface-variant">这里暂时还没有可显示的结果。</p>
      </div>
    );
  }

  const allItems = journal.items || [];
  const moveItems = allItems.filter((item) => item.action_type === "MOVE");
  const mkdirItems = allItems.filter((item) => item.action_type === "MKDIR" && item.target);
  const failedItems = moveItems.filter((item) => item.status === "failed");
  const reviewItems = moveItems.filter(isReviewJournalItem);
  const isPartial = (journal.failure_count || 0) > 0;
  const baseLabel = targetDir.split(/[\\/]/).filter(Boolean).at(-1) || "当前目录";
  const normalizedTargetDir = normalizeFsPath(targetDir);
  const topLevelCreatedDirs = Array.from(new Map(
    mkdirItems
      .map((item) => item.target)
      .filter((path): path is string => Boolean(path))
      .map((path) => normalizeFsPath(path))
      .filter((path) => {
        if (!normalizedTargetDir) return false;
        const lowerPath = path.toLowerCase();
        const lowerBase = normalizedTargetDir.toLowerCase();
        if (lowerPath === lowerBase) {
          return false;
        }
        const prefix = `${lowerBase}/`;
        if (!lowerPath.startsWith(prefix)) {
          return false;
        }
        const relative = path.slice(normalizedTargetDir.length).replace(/^[\\/]+/, "");
        if (!relative) return false;
        const parts = relative.split(/[\\/]/).filter(Boolean);
        return parts.length === 1 && parts[0].toLowerCase() !== "review";
      })
      .map((path) => [path.toLowerCase(), path] as const),
  ).values());
  const canBeautifyCreatedDirs = organizeMethod === "categorize_into_new_structure" && topLevelCreatedDirs.length > 0;

  const beforeTree = {
    title: "整理前目录树",
    subtitle: "执行前参与本次整理的原始文件位置。",
    leafEntries: moveItems
      .filter((item): item is typeof item & { source: string } => Boolean(item.source))
      .map<DirectoryTreeLeafEntry>((item) => ({ path: itemSourceToPath(item.source) })),
    basePath: targetDir,
    baseLabel,
    emptyLabel: "当前没有可展示的原始文件结构。",
  };

  /**
   * Helper to fix TS issues with item models vs path strings
   */
  function itemSourceToPath(source: any): string {
    return typeof source === 'string' ? source : (source?.path || "");
  }

  const afterTree = {
    title: "整理后目录树",
    subtitle: "执行后的目标目录结构。成功、失败和待确认区（不会自动归入目标目录）会在树中标出。",
    leafEntries: moveItems
      .filter((item): item is typeof item & { target: string } => Boolean(item.target))
      .map<DirectoryTreeLeafEntry>((item) => ({
        path: item.target,
        status: item.status === "failed" ? "failed" : isReviewJournalItem(item) ? "review" : "success",
      })),
    directoryEntries: mkdirItems
      .map((item) => item.target)
      .filter((target): target is string => Boolean(target)),
    basePath: targetDir,
    baseLabel,
    emptyLabel: "当前没有可展示的目标目录结构。",
  };

  const handleBeautifyIcons = () => {
    if (!canBeautifyCreatedDirs) return;
    router.push(`/icons?import_paths=${encodeURIComponent(JSON.stringify(topLevelCreatedDirs))}`);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface">
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin px-5 py-5 space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-6"
        >
        {/* Status Header - Workbench Style */}
        <div className={cn(
            "flex items-center gap-4 rounded-lg border px-5 py-2.5",
            isPartial 
                ? "border-error/15 bg-error/[0.02] text-error" 
                : "border-success/15 bg-success/[0.02] text-success-dim"
        )}>
            <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-black",
                isPartial ? "bg-error text-white" : "bg-success text-white"
            )}>
                {isPartial ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-black tracking-tight text-on-surface uppercase leading-none">
                    {isPartial ? "整理已完成，但有部分项目需要处理" : "文件整理已完成"}
                </h2>
            </div>
            <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                <div className="flex items-center gap-2 rounded bg-on-surface/[0.04] px-2 py-0.5 border border-on-surface/5">
                    <Folder className="h-2.5 w-2.5 opacity-30 text-primary" />
                    <span className="max-w-[200px] truncate font-mono text-[11px] font-bold text-on-surface/60" title={targetDir}>{targetDir}</span>
                </div>
            </div>
        </div>

        {/* Metrics Grid - High Density */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
                { label: "成功移动", count: journal.success_count || 0, icon: CheckCircle2, color: "text-success-dim", bg: "bg-success/5" },
                { label: "执行失败", count: journal.failure_count || 0, icon: AlertTriangle, color: isPartial ? "text-error" : "text-ui-muted", bg: isPartial ? "bg-error/5" : "bg-on-surface/5" },
                { label: "待确认区", count: reviewItems.length, icon: Layers, color: "text-warning", bg: "bg-warning/5" },
                { label: "处理总数", count: journal.item_count || 0, icon: History, color: "text-primary", bg: "bg-primary/5" },
            ].map((stat, i) => (
                <motion.div 
                    key={i} 
                    initial={{ opacity: 0, scale: 0.95, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 350, damping: 28, delay: i * 0.05 }}
                    className="flex flex-col gap-0.5 rounded-lg border border-on-surface/6 bg-on-surface/[0.015] p-2.5 transition-all hover:bg-on-surface/[0.03]"
                >
                    <div className="flex items-center justify-between">
                        <stat.icon className={cn("h-3 w-3 opacity-40", stat.color)} />
                        <div className={cn("text-[16px] font-black tabular-nums leading-none tracking-tighter", stat.color)}>
                            {stat.count}
                        </div>
                    </div>
                    <div className="text-[11px] font-black uppercase tracking-widest text-ui-muted opacity-40">
                        {stat.label}
                    </div>
                </motion.div>
            ))}
        </div>

        {/* Action Suggestion: Rollback on partial failure - Promoted to Card */}
        {isPartial && !readOnly ? (
        <motion.div
           initial={{ opacity: 0, y: 8, scale: 0.98 }}
           animate={{ opacity: 1, y: 0, scale: 1 }}
           transition={{ type: "spring", stiffness: 300, damping: 26, delay: 0.2 }}
           className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between rounded-lg border border-error/25 bg-error/[0.02] p-3.5 transition-colors hover:bg-error/[0.03]"
        >
           <div className="flex items-center gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-error/10 text-error">
                 <RotateCcw className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                 <h3 className="text-[13px] font-black tracking-tight text-on-surface uppercase">部分文件未能移动，建议先回退</h3>
                 <p className="mt-0.5 text-[11px] font-medium leading-relaxed text-ui-muted opacity-60">
                    本次整理有 {journal.failure_count || 0} 个项目执行失败，目录现在处于部分整理状态。回退会把已移动的 {journal.success_count || 0} 个项目放回原位，之后可以排查失败原因再重新整理。
                 </p>
              </div>
           </div>
           <button
              type="button"
              onClick={onRollback}
              disabled={isBusy || rollbackPreparing}
              className="shrink-0 flex h-8 items-center justify-center gap-2 rounded-md bg-error px-5 text-[11px] font-black text-white transition-all hover:bg-error/85 active:scale-95 disabled:opacity-50 uppercase tracking-widest"
            >
              {rollbackPreparing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {rollbackPreparing ? "正在预检..." : "回退本次整理"}
           </button>
        </motion.div>
        ) : null}

        {/* Action Suggestion: Beautify Icons - Promoted to Card */}
        {canBeautifyCreatedDirs ? (
        <motion.div 
           initial={{ opacity: 0, y: 8, scale: 0.98 }}
           animate={{ opacity: 1, y: 0, scale: 1 }}
           transition={{ type: "spring", stiffness: 300, damping: 26, delay: 0.25 }}
           className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between rounded-lg border border-primary/20 bg-primary/[0.01] p-3.5 transition-colors hover:bg-primary/[0.02]"
        >
           <div className="flex items-center gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                 <Palette className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                 <h3 className="text-[13px] font-black tracking-tight text-on-surface uppercase">为整理后的目录美化图标？</h3>
                 <p className="mt-0.5 text-[11px] font-medium leading-relaxed text-ui-muted opacity-60">
                    可以把本次新建出来的目录直接带入“图标工坊”，继续生成并应用更有辨识度的文件夹图标。
                 </p>
              </div>
           </div>
           <button
              type="button"
              onClick={handleBeautifyIcons}
              disabled={isBusy}
              className="shrink-0 flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-5 text-[11px] font-black text-white transition-all hover:bg-primary-dim active:scale-95 disabled:opacity-50 uppercase tracking-widest"
            >
              <Palette className="h-3.5 w-3.5" />
              去生成文件夹图标
           </button>
        </motion.div>
        ) : null}

        {/* Structure Visualization */}
        <section className="flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-black text-on-surface uppercase tracking-tight">整理前后变化</h3>
            <div className="flex items-center gap-0.5 rounded-md border border-on-surface/8 bg-on-surface/[0.02] p-0.5">
              {[
                { id: "all", label: "全部" },
                { id: "failed", label: `失败 (${journal.failure_count || 0})` },
                { id: "review", label: `待确认 (${reviewItems.length})` },
              ].map((btn) => (
                <button
                  key={btn.id}
                  onClick={() => setFilter(btn.id as DirectoryTreeFilter)}
                  className={cn(
                    "rounded-[4px] px-2.5 py-1 text-[11px] font-black uppercase tracking-widest transition-all active:scale-95",
                    filter === btn.id
                      ? "bg-on-surface text-surface"
                      : "text-ui-muted hover:text-on-surface hover:bg-on-surface/5",
                  )}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
          
          <div className="rounded-lg border border-on-surface/8 bg-transparent overflow-hidden">
            <DirectoryTreeDiff before={beforeTree} after={afterTree} filter={filter} onOpenExplorer={onOpenExplorer} />
          </div>
        </section>

        {(failedItems.length > 0 || reviewItems.length > 0) ? (
          <section className="shrink-0 flex flex-col gap-4 pb-6">
            <div className={cn("grid gap-4", (failedItems.length > 0 && reviewItems.length > 0) ? "lg:grid-cols-2" : "grid-cols-1")}>
              {failedItems.length > 0 && (
                <div className="flex flex-col rounded-lg border border-error/15 bg-error/[0.01] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-error/10 bg-error/5">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3 w-3 text-error" />
                        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-error">失败项</h3>
                    </div>
                    <span className="font-mono text-[11px] font-bold text-error/60">{failedItems.length} 项</span>
                  </div>
                  <div className="p-1 max-h-[280px] overflow-y-auto scrollbar-thin">
                    <div className="flex flex-col">
                      {failedItems.map((item, idx) => (
                        <div key={idx} className="group flex flex-col gap-1 p-2 transition-colors hover:bg-error/5 border-b border-error/5 last:border-0 text-[11px]">
                          <p className="truncate font-mono font-black text-on-surface/90" title={item.display_name}>{item.display_name}</p>
                          <div className="flex items-center gap-2 opacity-50">
                             <span className="text-[11px] font-black uppercase text-error/60">目标</span>
                             <p className="truncate font-mono text-[11px] text-error/70" title={item.target || ""}>{item.target}</p>
                          </div>
                          {item.message ? (
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 text-[11px] font-black uppercase text-error/60">原因</span>
                              <p className="text-[11px] font-medium leading-snug text-error/80" title={item.message}>{item.message}</p>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {reviewItems.length > 0 && (
                <div className="flex flex-col rounded-lg border border-warning/20 bg-warning/[0.01] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-warning/15 bg-warning/5">
                    <div className="flex items-center gap-2">
                        <Info className="h-3 w-3 text-warning-dim" />
                        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-warning-dim">待确认区</h3>
                    </div>
                    <span className="font-mono text-[11px] font-bold text-warning-dim/60">{reviewItems.length} 项</span>
                  </div>
                  <div className="p-1 max-h-[280px] overflow-y-auto scrollbar-thin">
                    <div className="flex flex-col font-mono">
                      {reviewItems.map((item, idx) => (
                        <div key={idx} className="group flex flex-col gap-1 p-2 transition-colors hover:bg-warning/5 border-b border-warning/5 last:border-0 text-[11px]">
                          <p className="truncate font-black text-on-surface/90" title={item.display_name}>{item.display_name}</p>
                          <div className="flex items-center gap-2 opacity-60">
                             <span className="text-[11px] font-black uppercase text-warning-dim/70">目标</span>
                             <p className="truncate text-[11px] text-warning-dim/80" title={item.target || ""}>{item.target}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : null}
        </motion.div>
      </div>

      <div className="shrink-0 border-t border-on-surface/8 pt-3 pb-5 px-4 lg:px-6 bg-surface-container-lowest/50 backdrop-blur-sm relative z-10">
        <div className={cn("flex flex-wrap items-center justify-between gap-4", readOnly ? "flex-row-reverse" : "")}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onGoHome}
              disabled={isBusy}
              className="group flex h-8.5 items-center justify-center gap-2 rounded-lg border border-on-surface/10 bg-surface px-3.5 text-[12px] font-black text-on-surface/60 transition-all hover:bg-on-surface/5 active:scale-95 disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
              返回首页
            </button>
            <div className="h-5 w-px bg-on-surface/10 mx-1" />
            <button
              type="button"
              onClick={() => onOpenExplorer(targetDir)}
              disabled={isBusy}
              className="flex h-8.5 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[12px] font-black text-white transition-all hover:bg-primary-dim active:scale-95 disabled:opacity-50"
            >
              <Folder className="h-3.5 w-3.5" />
              打开整理目录
            </button>
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCleanupConfirmOpen(true)}
                disabled={isBusy || isCleaning || cleanupCandidateCount <= 0}
                className={cn(
                  "flex h-8.5 items-center justify-center gap-2 rounded-lg border border-on-surface/10 bg-surface px-3.5 text-[12px] font-black transition-all active:scale-95 disabled:opacity-40",
                  cleanupCandidateCount > 0 && !isCleaning
                    ? "text-on-surface/75 border-on-surface/15 hover:bg-on-surface/5 hover:text-on-surface hover:border-on-surface/25"
                    : "text-on-surface/40"
                )}
                title={cleanupCandidateCount > 0 ? `将检查并清理 ${cleanupCandidateCount} 个空目录候选` : "当前没有可清理的空目录候选"}
              >
                {isCleaning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 opacity-55" />
                )}
                {isCleaning ? "正在清理..." : `清理空目录${cleanupCandidateCount > 0 ? ` (${cleanupCandidateCount})` : ""}`}
              </button>
              <button
                type="button"
                onClick={onRollback}
                disabled={isBusy || rollbackPreparing}
                className="flex h-8.5 items-center justify-center gap-2 rounded-lg border border-error/20 bg-error/5 px-3.5 text-[12px] font-black text-error/70 transition-all hover:bg-error/10 active:scale-95 disabled:opacity-50"
              >
                {rollbackPreparing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {rollbackPreparing ? "正在预检..." : "回退整理"}
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={cleanupConfirmOpen}
        title="确认清理空目录？"
        description={`将检查并清理本次整理后留下的 ${cleanupCandidateCount} 个空目录候选。只会删除仍为空的目录；如果目录里已有新内容，会自动跳过。`}
        confirmLabel="开始清理"
        cancelLabel="先不清理"
        tone="primary"
        loading={isBusy || isCleaning}
        onConfirm={async () => {
          setIsCleaning(true);
          try {
            await onCleanupDirs();
          } finally {
            setIsCleaning(false);
            setCleanupConfirmOpen(false);
          }
        }}
        onCancel={() => {
          if (!isCleaning) {
            setCleanupConfirmOpen(false);
          }
        }}
      />
    </div>
  );
}
