"use client";

import React from "react";
import { Layers, Sparkles, Folder, Search, ChevronDown, ChevronsDownUp, ChevronsUpDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanSnapshot, PreviewFilter } from "./preview-utils";

// --- Header Component ---

interface PreviewHeaderProps {
  plannerStatus: { preservesPreviousPlan: boolean; isRunning: boolean } | null;
  pendingQueueCount: number;
  blockingQueueCount: number;
  reviewQueueCount: number;
  canRunPrecheck: boolean;
  isPlanSyncing: boolean;
  plan: PlanSnapshot;
  viewMode: "before" | "after";
  setViewMode: (mode: "before" | "after") => void;
  search: string;
  setSearch: (value: string) => void;
  filter: PreviewFilter;
  setFilter: (filter: PreviewFilter) => void;
  extensionFilter: string;
  setExtensionFilter: (ext: string) => void;
  extensionOptions: string[];
  visibleCount: number;
  totalCount: number;
  incrementalSummary: { targetCount: number; pendingCount: number; targetDirectories: string[] } | null;
}

export function PreviewHeader({
  plannerStatus,
  pendingQueueCount,
  blockingQueueCount,
  reviewQueueCount,
  canRunPrecheck,
  isPlanSyncing,
  plan,
  viewMode,
  setViewMode,
  search,
  setSearch,
  filter,
  setFilter,
  extensionFilter,
  setExtensionFilter,
  extensionOptions,
  visibleCount,
  totalCount,
  incrementalSummary,
}: PreviewHeaderProps) {
  return (
    <div className="shrink-0">
      {plannerStatus?.isRunning && (plannerStatus as any).preservingPreviousPlan ? (
        <div className="border-b border-primary/10 bg-primary/[0.045] px-4 py-3 @lg:px-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-primary/14 bg-primary/8 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-on-surface">正在基于你的最新要求重算方案</p>
              <p className="mt-1 text-[12px] leading-5 text-on-surface-variant">当前显示的是上一版方案，新方案完成后会自动替换</p>
            </div>
          </div>
        </div>
      ) : null}
      <div className="border-b border-on-surface/6 px-6 py-3">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-primary/70">
              <Layers className="h-3.5 w-3.5" />
              方案预览
            </div>
            <span className={cn("rounded-[3px] border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest", pendingQueueCount > 0 || !canRunPrecheck ? "border-warning/30 bg-warning/5 text-warning" : "border-success/30 bg-success/5 text-success-dim")}>
              {blockingQueueCount > 0 ? `待处理 ${blockingQueueCount}` : reviewQueueCount > 0 ? `待核对 ${reviewQueueCount}` : canRunPrecheck ? "可进行检查" : isPlanSyncing ? "更新中" : "等待检查"}
            </span>
            <div className="flex shrink-0 items-center gap-1.5 rounded-[3px] border border-on-surface/8 bg-on-surface/[0.02] px-2 py-0.5 text-[9px] font-bold text-on-surface uppercase tracking-widest">
              <Sparkles className="h-2.5 w-2.5 text-primary/60" />
              <span>移动 {plan.stats.move_count}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 rounded-[3px] border border-on-surface/8 bg-on-surface/[0.02] px-2 py-0.5 text-[9px] font-bold text-on-surface uppercase tracking-widest">
              <Folder className="h-2.5 w-2.5 text-primary/60" />
              <span>新目录 {plan.stats.directory_count}</span>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate text-[14px] font-bold tracking-tight text-on-surface">
              {blockingQueueCount > 0 ? "先处理待处理项，再核对目标结构" : reviewQueueCount > 0 ? "核对待确认区，再检查移动风险" : "核对目标结构，准备进行检查"}
            </h2>
            {plan.summary ? (
              <p className="min-w-0 flex-1 truncate text-[11px] text-ui-muted/80">{plan.summary}</p>
            ) : null}
          </div>
        </div>

        {incrementalSummary ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[10px] border border-primary/10 bg-primary/[0.045] px-3 py-2">
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-primary">
              归入已有目录
            </span>
            <span className="text-[11px] font-semibold text-on-surface">
              已选目标目录 {incrementalSummary.targetCount} 个
            </span>
            <span className="text-[11px] text-ui-muted">
              待整理项 {incrementalSummary.pendingCount} 个
            </span>
            <span className="truncate text-[11px] text-ui-muted">
              目标池：{incrementalSummary.targetDirectories.join("、") || "未设置"}
            </span>
          </div>
        ) : null}
      </div>

      <div className="border-b border-on-surface/8 bg-on-surface/[0.02] px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          {/* View Switcher: Mechanical Style */}
          <div className="flex shrink-0 items-center rounded-md border border-on-surface/10 bg-on-surface/[0.02] p-0.5">
            <button 
              type="button" 
              onClick={() => setViewMode("before")} 
              className={cn(
                "flex items-center gap-1.5 rounded-[4px] px-3 py-1 text-[10px] font-black uppercase tracking-widest transition-all", 
                viewMode === "before" ? "bg-on-surface/10 text-on-surface" : "text-on-surface/40 hover:bg-on-surface/5"
              )}
            >
              <span className={cn("opacity-40", viewMode === "before" && "opacity-60")}>RAW</span>
              <span className="hidden @sm:inline">原始</span>
            </button>
            <button 
              type="button" 
              onClick={() => setViewMode("after")} 
              className={cn(
                "flex items-center gap-1.5 rounded-[4px] px-3 py-1 text-[10px] font-black uppercase tracking-widest transition-all", 
                viewMode === "after" ? "bg-primary/10 text-primary font-black" : "text-on-surface/40 hover:bg-on-surface/5"
              )}
            >
              <span className={cn("opacity-40", viewMode === "after" && "opacity-60")}>PLAN</span>
              <span className="hidden @sm:inline">建议</span>
            </button>
          </div>
          
          <div className="h-4 w-px bg-on-surface/8 mx-1" />

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative flex min-w-0 flex-1 items-center group">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-ui-muted pointer-events-none opacity-40 group-focus-within:text-primary transition-colors" />
              <input 
                value={search} 
                onChange={(event) => setSearch(event.target.value)} 
                placeholder="搜索节点..." 
                className="h-8 w-full rounded-md border border-on-surface/8 bg-surface-container-lowest pl-8 pr-2.5 text-[11px] font-black text-on-surface outline-none transition-all placeholder:text-ui-muted/50 focus:border-primary/40 focus:ring-1 focus:ring-primary/10" 
              />
            </div>

            <div className="relative flex shrink-0 items-center">
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as PreviewFilter)}
                className="h-8 min-w-[90px] appearance-none rounded-md border border-on-surface/8 bg-surface-container-lowest pl-2.5 pr-8 text-[11px] font-black text-on-surface outline-none transition-all hover:bg-on-surface/[0.02] focus:border-primary/40"
              >
                <option value="all">全部</option>
                <option value="changed">变更</option>
                <option value="unresolved">待定</option>
                <option value="review">核对</option>
                <option value="invalidated">需确认</option>
              </select>
              <ChevronDown className="absolute right-2.5 h-3 w-3 text-ui-muted pointer-events-none opacity-40" />
            </div>

            <div className="relative hidden shrink-0 items-center @3xl:flex">
              <select
                value={extensionFilter}
                onChange={(event) => setExtensionFilter(event.target.value)}
                className="h-8 appearance-none rounded-md border border-on-surface/8 bg-surface-container-lowest pl-2.5 pr-8 text-[11px] font-black text-on-surface outline-none transition-all hover:bg-on-surface/[0.02] focus:border-primary/40"
              >
                {extensionOptions.map((option) => (
                  <option key={option} value={option}>{option === "all" ? "类型" : option}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 h-3 w-3 text-ui-muted pointer-events-none opacity-40" />
            </div>
          </div>

          <div className="hidden shrink-0 items-center px-1 font-mono text-[10px] font-bold text-ui-muted/40 @5xl:flex">
            {visibleCount} / {totalCount}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Footer Component ---

interface PreviewFooterProps {
  readOnly: boolean;
  pendingQueueCount: number;
  precheckNotice: string;
  canRunPrecheck: boolean;
  isBusy: boolean;
  isPlanSyncing: boolean;
  onRunPrecheck: () => void;
  onFocusQueue: () => void;
}

export function PreviewFooter({
  readOnly,
  pendingQueueCount,
  precheckNotice,
  canRunPrecheck,
  isBusy,
  isPlanSyncing,
  onRunPrecheck,
  onFocusQueue,
}: PreviewFooterProps) {
  if (readOnly) return null;

  return (
    <div data-testid="preview-footer" className="sticky bottom-0 z-10 shrink-0 border-t border-on-surface/8 bg-surface-container-low px-6 py-4">
      {pendingQueueCount > 0 ? (
        <button
          type="button"
          onClick={onFocusQueue}
          className="mb-2 flex w-full items-center justify-between gap-3 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-on-surface transition-colors hover:bg-warning/8"
        >
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <span className="truncate">{precheckNotice}</span>
          </div>
          <span className="shrink-0 text-[12px] font-bold text-primary">点击查看</span>
        </button>
      ) : (
        <div className="mb-3 flex items-center gap-2 text-[13px] text-on-surface">
          {canRunPrecheck ? <CheckCircle2 className="h-4 w-4 text-success-dim" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
          <span>{precheckNotice}</span>
        </div>
      )}
      <button type="button" onClick={onRunPrecheck} disabled={isBusy || !canRunPrecheck} className={cn("flex w-full items-center justify-center gap-2 rounded-md py-3 text-[14px] font-black uppercase tracking-widest transition-all active:scale-[0.98]", canRunPrecheck && !isBusy ? "bg-primary text-white" : "cursor-not-allowed border border-on-surface/8 bg-on-surface/[0.05] text-ui-muted")}>
        <Layers className="h-4 w-4" />
        {isBusy ? "正在更新方案" : canRunPrecheck ? "检查移动风险" : pendingQueueCount > 0 ? "先处理待处理项" : isPlanSyncing ? "等待方案更新完成" : "等待方案准备好"}
      </button>
    </div>
  );
}
