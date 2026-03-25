"use client";

import { AlertCircle, ArrowRight, CheckCircle2, FolderPlus, ListChecks, ShieldAlert } from "lucide-react";
import { PrecheckSummary } from "@/types/session";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DirectoryTreeDiff, type DirectoryTreeLeafEntry, type DirectoryTreeFilter } from "./directory-tree-diff";
import { useState } from "react";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PrecheckViewProps {
  summary: PrecheckSummary | null;
  isBusy: boolean;
  readOnly?: boolean;
  onExecute: (confirm: boolean) => void;
  onBack: () => void;
}

function reviewMoveCount(summary: PrecheckSummary) {
  return summary.move_preview.filter((move) =>
    move.target.split(/[\\/]/).some((part) => part.toLowerCase() === "review"),
  ).length;
}

export function PrecheckView({ summary, isBusy, readOnly = false, onExecute, onBack }: PrecheckViewProps) {
  if (!summary) {
    return null;
  }

  const [filter, setFilter] = useState<DirectoryTreeFilter>("all");
  const hasErrors = summary.blocking_errors.length > 0;
  const hasWarnings = summary.warnings.length > 0;
  const reviewCount = reviewMoveCount(summary);
  const summaryTone = hasErrors ? "danger" : hasWarnings ? "warning" : "success";

  const statusBadgeClass = cn(
    "inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold shadow-sm",
    summaryTone === "danger"
      ? "border-error/20 bg-error-container/15 text-error"
      : summaryTone === "warning"
        ? "border-warning/20 bg-warning-container/15 text-warning"
        : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
  );

  const statusTitle = hasErrors
    ? "当前不能执行"
    : hasWarnings
      ? "可执行，但建议先看提醒"
      : "可以执行";
  const statusDescription = hasErrors
    ? "预检发现了必须先处理的问题，先修复后再执行会更安全。"
    : hasWarnings
      ? "结构已经通过，但还有一些提醒值得先确认。"
      : "结构检查已经通过，可以进入真实执行阶段。";

  const beforeTree = {
    title: "整理前目录树",
    subtitle: "这里是这次会参与整理的原始位置。",
    leafEntries: summary.move_preview.map((move) => ({ path: move.source })),
    emptyLabel: "当前没有可预检的原始路径。",
  };

  const afterTree = {
    title: "整理后目录树",
    subtitle: "这里是预检通过后将形成的目标结构，暂时还不会真正移动文件。",
    leafEntries: summary.move_preview.map<DirectoryTreeLeafEntry>((move) => ({
      path: move.target,
      status: move.target.split(/[\\/]/).some((part) => part.toLowerCase() === "review") ? "review" : "pending",
    })),
    directoryEntries: summary.mkdir_preview,
    emptyLabel: "当前没有可展示的目标目录结构。",
  };

  return (
    <div className="mx-auto max-w-6xl space-y-10 py-6">
      <div className="space-y-6 rounded-[2rem] border border-on-surface/6 bg-white/76 p-6 shadow-sm lg:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/6 px-3 py-1 text-ui-meta font-semibold text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              执行概览
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-on-surface">{statusTitle}</h2>
              <p className="mt-2 max-w-2xl text-ui-body text-ui-muted">
                {statusDescription} 这一页只帮你确认真实影响范围，现在还不会真正移动文件。
              </p>
            </div>
          </div>

          <div className={statusBadgeClass}>
            {summaryTone === "danger" ? (
              <ShieldAlert className="h-4 w-4" />
            ) : summaryTone === "warning" ? (
              <AlertCircle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {statusTitle}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-[1.5rem] border border-on-surface/6 bg-white/88 p-5 shadow-sm">
            <p className="text-ui-meta font-semibold">将移动的条目</p>
            <p className="mt-3 text-3xl font-black text-on-surface">{summary.move_preview.length}</p>
            <p className="mt-2 text-ui-meta">这些条目会在执行阶段按目标结构落位。</p>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface/6 bg-white/88 p-5 shadow-sm">
            <p className="text-ui-meta font-semibold">将新建的目录</p>
            <p className="mt-3 text-3xl font-black text-on-surface">{summary.mkdir_preview.length}</p>
            <p className="mt-2 text-ui-meta">执行前会确认这些目录可以正常创建和使用。</p>
          </div>
          <div className="rounded-[1.5rem] border border-warning/12 bg-warning-container/10 p-5 shadow-sm">
            <p className="text-ui-meta font-semibold text-warning">进入 Review 的条目</p>
            <p className="mt-3 text-3xl font-black text-on-surface">{reviewCount}</p>
            <p className="mt-2 text-ui-meta">这些条目会先进 `Review`，不会丢失，后续仍可继续整理。</p>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface/6 bg-white/88 p-5 shadow-sm">
            <p className="text-ui-meta font-semibold">Blocking errors</p>
            <p className="mt-3 text-2xl font-black text-on-surface">{hasErrors ? "有" : "无"}</p>
            <p className="mt-2 text-ui-meta">{hasErrors ? "存在必须先处理的问题。" : "当前没有阻止执行的问题。"}</p>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface/6 bg-white/88 p-5 shadow-sm">
            <p className="text-ui-meta font-semibold">Warnings</p>
            <p className="mt-3 text-2xl font-black text-on-surface">{hasWarnings ? "有" : "无"}</p>
            <p className="mt-2 text-ui-meta">{hasWarnings ? "建议执行前先阅读提醒。" : "当前没有额外提醒。"}</p>
          </div>
          <div className="rounded-[1.5rem] border border-primary/10 bg-primary/6 p-5 shadow-sm">
            <p className="text-ui-meta font-semibold text-primary">回退能力</p>
            <p className="mt-3 text-2xl font-black text-on-surface">支持最近一次回退</p>
            <p className="mt-2 text-ui-meta">如果结果不合适，之后仍可以按最近一次执行记录回退。</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-on-surface">目录树前后对比</h3>
            <p className="text-sm text-ui-muted">先看上面的执行概览，再到这里确认具体会落在哪些目录。</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-2xl bg-surface-container-low p-1 border border-on-surface/5">
            {[
              { id: "all", label: "全部" },
              { id: "review", label: "Review" },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setFilter(btn.id as any)}
                className={cn(
                  "px-4 py-1.5 text-[12px] font-semibold rounded-xl transition-all",
                  filter === btn.id 
                    ? "bg-white text-primary shadow-sm" 
                    : "text-ui-muted hover:text-on-surface"
                )}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
        <DirectoryTreeDiff before={beforeTree} after={afterTree} filter={filter} />
      </div>

      {(hasErrors || hasWarnings) ? (
        <div className="space-y-4 rounded-[1.75rem] border border-on-surface/6 bg-surface-container-low/45 p-6">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-on-surface/35" />
            <h3 className="text-base font-bold text-on-surface">预检结果</h3>
          </div>

          <div className="space-y-3">
            {summary.blocking_errors.map((err, index) => (
              <div key={`${err}-${index}`} className="flex items-start gap-3 rounded-2xl border border-error/15 bg-white px-4 py-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
                <div>
                  <p className="text-sm font-bold text-on-surface">必须先处理</p>
                  <p className="mt-1 text-sm leading-6 text-on-surface-variant">{err}</p>
                </div>
              </div>
            ))}

            {summary.warnings.map((warn, index) => (
              <div key={`${warn}-${index}`} className="flex items-start gap-3 rounded-2xl border border-warning/15 bg-white px-4 py-4">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div>
                  <p className="text-sm font-bold text-on-surface">建议执行前确认</p>
                  <p className="mt-1 text-sm leading-6 text-on-surface-variant">{warn}</p>
                </div>
              </div>
            ))}

            {reviewCount > 0 ? (
              <div className="flex items-start gap-3 rounded-2xl border border-primary/15 bg-white px-4 py-4">
                <FolderPlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-bold text-on-surface">Review 提醒</p>
                  <p className="mt-1 text-sm leading-6 text-on-surface-variant">
                    这次有 {reviewCount} 项会先进入 `Review`。这些内容不会丢失，之后仍可继续整理或重新归类。
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="space-y-5 rounded-[1.75rem] border border-primary/10 bg-primary/6 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-white">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-on-surface">{readOnly ? "这是之前的只读结果" : "确认执行这次整理吗？"}</h4>
            <p className="mt-1 text-sm leading-6 text-on-surface-variant">
              {readOnly
                ? "这里只用于查看之前的预检结果。如需继续整理，请回到首页重新选择。"
                : "执行后会真实移动本地文件。如果结果不合适，之后仍然可以按最近一次执行记录回退。"}
            </p>
          </div>
        </div>

        {!readOnly ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onBack}
              disabled={isBusy}
              className="rounded-2xl border border-on-surface/10 px-5 py-4 text-sm font-bold text-on-surface-variant transition-colors hover:bg-white hover:text-on-surface disabled:opacity-40"
            >
              返回继续修改
            </button>
            <button
              type="button"
              onClick={() => onExecute(true)}
              disabled={isBusy || hasErrors}
              className="inline-flex flex-1 items-center justify-center gap-3 rounded-2xl bg-primary px-5 py-4 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-30"
            >
              <ArrowRight className="h-4 w-4" />
              确认执行
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
