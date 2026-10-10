"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, Folder, FolderOpen, History, Info, Layers, Loader2, Palette, RotateCcw, ShieldCheck, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrganizeMethod, JournalSummary, SessionSnapshot } from "@/types/session";
import { DirectoryTreeDiff, type DirectoryTreeLeafEntry, type DirectoryTreeFilter } from "./directory-tree-diff";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FileRadarIllustration } from "@/components/ui/svg-illustrations";
import { useTranslation } from "react-i18next";

/** 计算一组路径的公共祖先路径（不区分大小写）。 */
function computeCommonAncestor(paths: string[]): string {
  const normalized = paths
    .map((p) => p.replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter(Boolean);
  if (!normalized.length) return "";
  const parts = normalized[0].split("/");
  let common = parts;
  for (const p of normalized.slice(1)) {
    const segs = p.split("/");
    let i = 0;
    while (i < common.length && i < segs.length && common[i].toLowerCase() === segs[i].toLowerCase()) i++;
    common = common.slice(0, i);
  }
  return common.join("/");
}


interface CompletionViewProps {
  journal: JournalSummary | null;
  rollbackReport?: NonNullable<SessionSnapshot["rollback_report"]> | null;
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
  rollbackReport = null,
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
  const { t } = useTranslation("common");
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
          <p className="text-[14px] font-black text-on-surface">{t("workspace.completion.loadError")}</p>
          <p className="text-[12px] font-medium text-on-surface-variant">{loadError}</p>
        </div>
        <div className="flex items-center gap-3">
          {onRetryLoad ? (
            <button
              type="button"
              onClick={onRetryLoad}
              className="rounded-[8px] bg-primary px-4 py-2 text-[12px] font-bold text-white transition-opacity hover:opacity-90"
            >
              {t("workspace.completion.retryLoad")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onGoHome}
            className="rounded-[8px] border border-on-surface/10 bg-surface px-4 py-2 text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-on-surface/5"
          >
            {t("workspace.completion.home")}
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
        <p className="text-sm font-medium text-on-surface-variant">{t("workspace.completion.empty")}</p>
      </div>
    );
  }

  const allItems = journal.items || [];
  const moveItems = allItems.filter((item) => item.action_type === "MOVE");
  const mkdirItems = allItems.filter((item) => item.action_type === "MKDIR" && item.target);
  const failedItems = moveItems.filter((item) => item.status === "failed");
  // 「留在原地」与「已归位」同等重要：看不到跳过项，用户的默认假设是「漏了」
  const skippedItems = moveItems.filter((item) => item.status === "skipped");
  const reviewItems = moveItems.filter(isReviewJournalItem);
  const isPartial = (journal.failure_count || 0) > 0;
  const baseLabel = targetDir.split(/[\\/]/).filter(Boolean).at(-1) || t("workspace.completion.currentFolder");
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
    title: t("workspace.completion.beforeTitle"),
    subtitle: t("workspace.completion.beforeDescription"),
    leafEntries: moveItems
      .filter((item): item is typeof item & { source: string } => Boolean(item.source))
      .map<DirectoryTreeLeafEntry>((item) => ({ path: itemSourceToPath(item.source) })),
    basePath: targetDir,
    baseLabel,
    emptyLabel: t("workspace.completion.beforeEmpty"),
  };

  /**
   * Helper to fix TS issues with item models vs path strings
   */
  function itemSourceToPath(source: any): string {
    return typeof source === 'string' ? source : (source?.path || "");
  }

  // 计算整理后文件的公共祖先基目录（支持跨目录归档，避免出现盘符根节点）
  const afterTargetPaths = moveItems
    .filter((item): item is typeof item & { target: string } => Boolean(item.target))
    .map((item) => item.target);
  const afterBasePath = computeCommonAncestor(afterTargetPaths) || normalizeFsPath(targetDir);
  const afterBaseLabel = afterBasePath.split(/[/\\]/).filter(Boolean).at(-1) || baseLabel;

  // 按目标分类目录统计归档文件数（取公共祖先的直接子目录作为分组 key）
  const targetGroupMap = new Map<string, { dirPath: string; count: number }>();
  for (const item of moveItems) {
    if (item.status !== "success" || !item.target) continue;
    const normalized = item.target.replace(/\\/g, "/").replace(/\/+$/, "");
    const relative = normalized.slice(afterBasePath.length).replace(/^\/+/, "");
    const topDir = relative.split("/")[0];
    if (!topDir) continue;
    const dirPath = `${afterBasePath}/${topDir}`;
    const existing = targetGroupMap.get(topDir);
    targetGroupMap.set(topDir, { dirPath, count: (existing?.count ?? 0) + 1 });
  }
  const targetGroups = Array.from(targetGroupMap.entries())
    .map(([name, { dirPath, count }]) => ({ name, dirPath, count }))
    .sort((a, b) => b.count - a.count);

  const afterTree = {
    title: t("workspace.completion.afterTitle"),
    subtitle: t("workspace.completion.afterDescription"),
    leafEntries: moveItems
      .filter((item): item is typeof item & { target: string } => Boolean(item.target))
      .map<DirectoryTreeLeafEntry>((item) => ({
        path: item.target,
        status: item.status === "failed" ? "failed" : isReviewJournalItem(item) ? "review" : "success",
      })),
    directoryEntries: mkdirItems
      .map((item) => item.target)
      .filter((target): target is string => Boolean(target)),
    basePath: afterBasePath,
    baseLabel: afterBaseLabel,
    emptyLabel: t("workspace.completion.afterEmpty"),
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
        {rollbackReport ? (
          <div className="flex items-center gap-4 rounded-xl border border-success/20 bg-success/[0.04] px-5 py-3.5 shadow-sm">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success text-white font-bold">
              <Undo2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-bold tracking-tight text-on-surface">
                {rollbackReport.failure_count > 0 ? t("workspace.completion.rollbackPartial") : t("workspace.completion.rollbackComplete")}
              </h2>
              <p className="mt-0.5 text-[12px] font-medium text-on-surface-variant/70">
                {rollbackReport.failure_count > 0
                  ? t("workspace.completion.rollbackPartialSummary", { success: rollbackReport.success_count, failure: rollbackReport.failure_count })
                  : t("workspace.completion.rollbackCompleteSummary", { count: rollbackReport.success_count })}
              </p>
            </div>
            <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
              <div className="flex items-center gap-2 rounded-md bg-on-surface/[0.03] px-2.5 py-1 border border-on-surface/8">
                <Folder className="h-3 w-3 opacity-40 text-primary" />
                <span className="max-w-[200px] truncate font-mono text-[11px] font-bold text-on-surface/70" title={targetDir}>{targetDir}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className={cn(
              "flex items-center gap-4 rounded-xl border px-5 py-3 shadow-sm",
              isPartial 
                  ? "border-error/20 bg-error/[0.03] text-error" 
                  : "border-success/20 bg-success/[0.03] text-success-dim"
          )}>
              <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold",
                  isPartial ? "bg-error text-white" : "bg-success text-white"
              )}>
                  {isPartial ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                  <h2 className="text-[14px] font-bold tracking-tight text-on-surface uppercase leading-none">
                      {isPartial ? t("workspace.completion.partialComplete") : t("workspace.completion.complete")}
                  </h2>
              </div>
              <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  <div className="flex items-center gap-2 rounded-md bg-on-surface/[0.03] px-2.5 py-1 border border-on-surface/8">
                      <Folder className="h-3 w-3 opacity-40 text-primary" />
                      <span className="max-w-[200px] truncate font-mono text-[11px] font-bold text-on-surface/70" title={targetDir}>{targetDir}</span>
                  </div>
              </div>
          </div>
        )}

        {/* Metrics Grid - High Density */}
        <div className={cn("grid grid-cols-2 gap-2.5", (skippedItems.length > 0 || reviewItems.length > 0) ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
            {[
                { label: t("workspace.completion.moved"), count: journal.success_count || 0, icon: CheckCircle2, color: "text-success-dim", bg: "bg-success/8" },
                ...(skippedItems.length > 0
                  ? [{ label: t("workspace.completion.keptInPlace"), count: skippedItems.length, icon: ShieldCheck, color: "text-emerald-500", bg: "bg-emerald-500/8" }]
                  : []),
                ...(reviewItems.length > 0 && organizeMethod !== "assign_into_existing_categories"
                  ? [{ label: t("workspace.completion.review"), count: reviewItems.length, icon: Layers, color: "text-warning", bg: "bg-warning/8" }]
                  : []),
                { label: t("workspace.completion.failed"), count: journal.failure_count || 0, icon: AlertTriangle, color: isPartial ? "text-error" : "text-ui-muted", bg: isPartial ? "bg-error/8" : "bg-on-surface/8" },
                { label: t("workspace.completion.total"), count: journal.item_count || 0, icon: History, color: "text-primary", bg: "bg-primary/8" },
            ].map((stat, i) => (
                <motion.div 
                    key={i} 
                    initial={{ opacity: 0, scale: 0.96, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 350, damping: 28, delay: i * 0.05 }}
                    className="flex flex-col gap-1.5 rounded-xl border border-on-surface/8 bg-surface-container-lowest p-3 shadow-sm transition-all hover:border-on-surface/16"
                >
                    <div className="flex items-center justify-between">
                        <div className={cn("flex h-6 w-6 items-center justify-center rounded-md", stat.bg)}>
                            <stat.icon className={cn("h-3 w-3", stat.color)} />
                        </div>
                        <div className={cn("font-mono text-[17px] font-black tabular-nums leading-none", stat.color)}>
                            {stat.count}
                        </div>
                    </div>
                    <div className="text-[11px] font-bold tracking-wider text-ui-muted/70">
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
                 <h3 className="text-[13px] font-black tracking-tight text-on-surface uppercase">{t("workspace.completion.partialTitle")}</h3>
                 <p className="mt-0.5 text-[11px] font-medium leading-relaxed text-ui-muted opacity-60">
                    {t("workspace.completion.partialDescription", { failure: journal.failure_count || 0, success: journal.success_count || 0 })}
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
              {rollbackPreparing ? t("workspace.completion.checking") : t("workspace.completion.rollbackAll")}
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
                 <h3 className="text-[13px] font-black tracking-tight text-on-surface uppercase">{t("workspace.completion.beautifyTitle")}</h3>
                 <p className="mt-0.5 text-[11px] font-medium leading-relaxed text-ui-muted opacity-60">
                    {t("workspace.completion.beautifyDescription")}
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
              {t("workspace.completion.createIcons")}
           </button>
        </motion.div>
        ) : null}

        {/* 归档成果卡片 - 仅在一键整理（assign_into_existing_categories）模式下展示 */}
        {organizeMethod === "assign_into_existing_categories" && targetGroups.length > 0 ? (
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.15 }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-[12px] font-black text-on-surface uppercase tracking-tight">{t("workspace.completion.archiveResults")}</h3>
              <span className="text-[11px] font-semibold text-on-surface-variant/50">{t("workspace.completion.distributedTo", { count: targetGroups.length })}</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {targetGroups.map(({ name, dirPath, count }) => (
                <div
                  key={name}
                  className="group flex min-w-[140px] max-w-[200px] flex-shrink-0 flex-col gap-1 rounded-lg border border-on-surface/8 bg-surface-container-lowest p-3 transition-all hover:border-primary/20 hover:bg-primary/[0.02]"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary">
                      <Folder className="h-3.5 w-3.5" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-black text-on-surface" title={name}>
                      {name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success-dim">
                      {t("workspace.completion.fileCount", { count })}
                    </span>
                    {onOpenExplorer ? (
                      <button
                        type="button"
                        onClick={() => onOpenExplorer(dirPath.replace(/\//g, "\\\\"))}
                        title={t("workspace.completion.openFolder", { name })}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-on-surface-variant/40 opacity-0 transition-all group-hover:opacity-100 hover:bg-primary/8 hover:text-primary active:scale-90"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </motion.section>
        ) : null}

        {/* Structure Visualization */}
        <section className="flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-black text-on-surface uppercase tracking-tight">{t("workspace.completion.beforeAfter")}</h3>
            <div className="flex items-center gap-0.5 rounded-md border border-on-surface/8 bg-on-surface/[0.02] p-0.5">
              {[
                { id: "all", label: t("workspace.completion.all") },
                { id: "failed", label: t("workspace.completion.failedFilter", { count: journal.failure_count || 0 }) },
                { id: "review", label: t("workspace.completion.reviewFilter", { count: reviewItems.length }) },
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

        {(failedItems.length > 0 || reviewItems.length > 0 || skippedItems.length > 0) ? (
          <section className="shrink-0 flex flex-col gap-4 pb-6">
            <div className={cn(
              "grid gap-4",
              [failedItems.length > 0, reviewItems.length > 0, skippedItems.length > 0].filter(Boolean).length > 1
                ? "lg:grid-cols-2"
                : "grid-cols-1",
            )}>
              {skippedItems.length > 0 && (
                <div className="flex flex-col rounded-lg border border-warning/20 bg-warning/[0.01] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-warning/15 bg-warning/5">
                    <div className="flex items-center gap-2">
                        <Info className="h-3 w-3 text-warning-dim" />
                        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-warning-dim">{t("workspace.completion.skippedTitle")}</h3>
                    </div>
                    <span className="font-mono text-[11px] font-bold text-warning-dim/60">{t("workspace.completion.skippedCount", { count: skippedItems.length })}</span>
                  </div>
                  <p className="px-4 py-1.5 text-[11px] font-medium leading-snug text-on-surface-variant/70 border-b border-warning/10">
                    {t("workspace.completion.skippedDescription")}
                  </p>
                  <div className="p-1 max-h-[280px] overflow-y-auto scrollbar-thin">
                    <div className="flex flex-col">
                      {skippedItems.map((item, idx) => (
                        <div key={idx} className="group flex flex-col gap-1 p-2 transition-colors hover:bg-warning/5 border-b border-warning/5 last:border-0 text-[11px]">
                          <p className="truncate font-mono font-black text-on-surface/90" title={item.display_name}>{item.display_name}</p>
                          {item.message ? (
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 text-[11px] font-black uppercase text-warning-dim/70">{t("workspace.completion.reason")}</span>
                              <p className="text-[11px] font-medium leading-snug text-on-surface-variant/80" title={item.message}>{item.message}</p>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {failedItems.length > 0 && (
                <div className="flex flex-col rounded-lg border border-error/15 bg-error/[0.01] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-error/10 bg-error/5">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3 w-3 text-error" />
                        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-error">{t("workspace.completion.failedItems")}</h3>
                    </div>
                    <span className="font-mono text-[11px] font-bold text-error/60">{t("workspace.completion.itemCount", { count: failedItems.length })}</span>
                  </div>
                  <div className="p-1 max-h-[280px] overflow-y-auto scrollbar-thin">
                    <div className="flex flex-col">
                      {failedItems.map((item, idx) => (
                        <div key={idx} className="group flex flex-col gap-1 p-2 transition-colors hover:bg-error/5 border-b border-error/5 last:border-0 text-[11px]">
                          <p className="truncate font-mono font-black text-on-surface/90" title={item.display_name}>{item.display_name}</p>
                          <div className="flex items-center gap-2 opacity-50">
                             <span className="text-[11px] font-black uppercase text-error/60">{t("workspace.completion.target")}</span>
                             <p className="truncate font-mono text-[11px] text-error/70" title={item.target || ""}>{item.target}</p>
                          </div>
                          {item.message ? (
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 text-[11px] font-black uppercase text-error/60">{t("workspace.completion.reason")}</span>
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
                        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-warning-dim">{t("workspace.completion.reviewItems")}</h3>
                    </div>
                    <span className="font-mono text-[11px] font-bold text-warning-dim/60">{t("workspace.completion.itemCount", { count: reviewItems.length })}</span>
                  </div>
                  <div className="p-1 max-h-[280px] overflow-y-auto scrollbar-thin">
                    <div className="flex flex-col font-mono">
                      {reviewItems.map((item, idx) => (
                        <div key={idx} className="group flex flex-col gap-1 p-2 transition-colors hover:bg-warning/5 border-b border-warning/5 last:border-0 text-[11px]">
                          <p className="truncate font-black text-on-surface/90" title={item.display_name}>{item.display_name}</p>
                          <div className="flex items-center gap-2 opacity-60">
                             <span className="text-[11px] font-black uppercase text-warning-dim/70">{t("workspace.completion.target")}</span>
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
              className={cn(
                "group flex h-8.5 items-center justify-center gap-2 rounded-lg px-4 text-[12px] font-bold transition-all active:scale-95 disabled:opacity-50",
                rollbackReport
                  ? "bg-primary text-white shadow-sm hover:bg-primary-dim"
                  : "border border-on-surface/10 bg-surface text-on-surface/70 hover:bg-on-surface/5 hover:text-on-surface"
              )}
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
              {t("workspace.completion.home")}
            </button>
            <div className="h-5 w-px bg-on-surface/10 mx-1" />
            <button
              type="button"
              onClick={() => onOpenExplorer(targetDir)}
              disabled={isBusy}
              className={cn(
                "flex h-8.5 items-center justify-center gap-2 rounded-lg px-4 text-[12px] font-bold transition-all active:scale-95 disabled:opacity-50",
                rollbackReport
                  ? "border border-on-surface/10 bg-surface text-on-surface/75 hover:bg-on-surface/5 hover:text-on-surface"
                  : "bg-primary text-white shadow-sm hover:bg-primary-dim"
              )}
            >
              <Folder className="h-3.5 w-3.5" />
              {t("workspace.completion.openTargetFolder")}
            </button>
          </div>

          {!readOnly && !rollbackReport && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCleanupConfirmOpen(true)}
                disabled={isBusy || isCleaning || cleanupCandidateCount <= 0}
                className={cn(
                  "flex h-8.5 items-center justify-center gap-2 rounded-lg border border-on-surface/10 bg-surface px-3.5 text-[12px] font-bold transition-all active:scale-95 disabled:opacity-40",
                  cleanupCandidateCount > 0 && !isCleaning
                    ? "text-on-surface/75 border-on-surface/15 hover:bg-on-surface/5 hover:text-on-surface hover:border-on-surface/25"
                    : "text-on-surface/40"
                )}
                title={cleanupCandidateCount > 0 ? t("workspace.completion.cleanupTitle", { count: cleanupCandidateCount }) : t("workspace.completion.cleanupUnavailable")}
              >
                {isCleaning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 opacity-55" />
                )}
                {isCleaning ? t("workspace.completion.cleaning") : `${t("workspace.completion.cleanup")}${cleanupCandidateCount > 0 ? ` (${cleanupCandidateCount})` : ""}`}
              </button>
              <button
                type="button"
                onClick={onRollback}
                disabled={isBusy || rollbackPreparing}
                className="flex h-8.5 items-center justify-center gap-2 rounded-lg border border-error/20 bg-error/5 px-3.5 text-[12px] font-bold text-error/80 transition-all hover:bg-error/10 active:scale-95 disabled:opacity-50"
              >
                {rollbackPreparing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {rollbackPreparing ? t("workspace.completion.checking") : t("workspace.completion.rollback")}
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={cleanupConfirmOpen}
        title={t("workspace.completion.confirmCleanupTitle")}
        description={t("workspace.completion.confirmCleanupDescription", { count: cleanupCandidateCount })}
        confirmLabel={t("workspace.completion.startCleanup")}
        cancelLabel={t("workspace.completion.cancelCleanup")}
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
