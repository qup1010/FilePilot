"use client";

import { AlertCircle, ArrowRight, CheckCircle2, FolderPlus, ListChecks, ShieldAlert } from "lucide-react";
import { PrecheckSummary } from "@/types/session";
import { cn } from "@/lib/utils";
import { DirectoryTreeDiff, type DirectoryTreeLeafEntry, type DirectoryTreeFilter } from "./directory-tree-diff";
import { useState } from "react";

interface PrecheckViewProps {
  summary: PrecheckSummary | null;
  isBusy: boolean;
  readOnly?: boolean;
  onRequestExecute: () => void;
  onBack: () => void;
}

function reviewMoveCount(summary: PrecheckSummary) {
  return summary.move_preview.filter((move) =>
    move.target.split(/[\\/]/).some((part) => part.toLowerCase() === "review"),
  ).length;
}

export function PrecheckView({ summary, isBusy, readOnly = false, onRequestExecute, onBack }: PrecheckViewProps) {
  const [filter, setFilter] = useState<DirectoryTreeFilter>("all");

  if (!summary) {
    return null;
  }

  const hasErrors = summary.blocking_errors.length > 0;
  const hasWarnings = summary.warnings.length > 0;
  const reviewCount = reviewMoveCount(summary);
  const summaryTone = hasErrors ? "danger" : hasWarnings ? "warning" : "success";

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
    <div className="mx-auto max-w-[1360px] space-y-5 py-5">
      <section className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
        <div className="border-b border-on-surface/8 bg-surface-container-low px-5 py-4 lg:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/12 bg-primary/6 px-3 py-1 text-[12px] font-medium text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" />
                执行概览
              </div>
              <h2 className="text-[1.35rem] font-black tracking-tight text-on-surface lg:text-[1.6rem]">{statusTitle}</h2>
              <p className="max-w-3xl text-[14px] leading-7 text-ui-muted">
                {statusDescription} 这一页只帮你确认真实影响范围，现在还不会真正移动文件。
              </p>
            </div>

            <div className={cn(
              "inline-flex items-center gap-2 rounded-[10px] border px-4 py-3 text-[13px] font-medium",
              summaryTone === "danger"
                ? "border-error/18 bg-error-container/25 text-error"
                : summaryTone === "warning"
                  ? "border-warning/20 bg-warning-container/25 text-warning"
                  : "border-emerald-500/16 bg-emerald-500/10 text-emerald-700",
            )}>
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
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
          <div className="grid gap-0 border-r border-on-surface/8 sm:grid-cols-2 xl:grid-cols-3">
            <div className="border-b border-on-surface/8 px-5 py-4 xl:border-b-0 xl:border-r">
              <p className="text-[12px] font-medium text-ui-muted">将移动的条目</p>
              <p className="mt-2 text-[1.8rem] font-black tracking-tight text-on-surface">{summary.move_preview.length}</p>
              <p className="mt-2 text-[12px] leading-6 text-ui-muted">这些条目会在执行阶段按目标结构落位。</p>
            </div>
            <div className="border-b border-on-surface/8 px-5 py-4 sm:border-l xl:border-b-0 xl:border-l-0 xl:border-r">
              <p className="text-[12px] font-medium text-ui-muted">将新建的目录</p>
              <p className="mt-2 text-[1.8rem] font-black tracking-tight text-on-surface">{summary.mkdir_preview.length}</p>
              <p className="mt-2 text-[12px] leading-6 text-ui-muted">执行前会确认这些目录可以正常创建和使用。</p>
            </div>
            <div className="border-b border-on-surface/8 px-5 py-4 sm:col-span-2 xl:col-span-1 xl:border-b-0">
              <p className="text-[12px] font-medium text-warning">进入 Review 的条目</p>
              <p className="mt-2 text-[1.8rem] font-black tracking-tight text-on-surface">{reviewCount}</p>
              <p className="mt-2 text-[12px] leading-6 text-ui-muted">这些条目会先进 `Review`，不会丢失，后续仍可继续整理。</p>
            </div>
          </div>

          <div className="grid gap-0 sm:grid-cols-3 lg:grid-cols-1">
            <div className="border-b border-on-surface/8 px-5 py-4 sm:border-r lg:border-r-0">
              <p className="text-[12px] font-medium text-ui-muted">阻断错误</p>
              <p className="mt-2 text-[1.5rem] font-black tracking-tight text-on-surface">{hasErrors ? "有" : "无"}</p>
              <p className="mt-2 text-[12px] leading-6 text-ui-muted">{hasErrors ? "存在必须先处理的问题。" : "当前没有阻止执行的问题。"}</p>
            </div>
            <div className="border-b border-on-surface/8 px-5 py-4 sm:border-r lg:border-r-0">
              <p className="text-[12px] font-medium text-ui-muted">注意事项</p>
              <p className="mt-2 text-[1.5rem] font-black tracking-tight text-on-surface">{hasWarnings ? "有" : "无"}</p>
              <p className="mt-2 text-[12px] leading-6 text-ui-muted">{hasWarnings ? "建议执行前先阅读提醒。" : "当前没有额外提醒。"}</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-[12px] font-medium text-primary">回退能力</p>
              <p className="mt-2 text-[1.1rem] font-black tracking-tight text-on-surface">支持最近一次回退</p>
              <p className="mt-2 text-[12px] leading-6 text-ui-muted">如果结果不合适，之后仍可以按最近一次执行记录回退。</p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-5 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col gap-3 border-b border-on-surface/8 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-ui-muted">结构对比</p>
            <h3 className="text-[15px] font-black tracking-tight text-on-surface">目录树前后对比</h3>
            <p className="text-[13px] leading-6 text-ui-muted">先看上面的执行概览，再到这里确认具体会落在哪些目录。</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-[10px] border border-on-surface/8 bg-surface-container p-1">
            {[
              { id: "all", label: "全部" },
              { id: "review", label: "Review" },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setFilter(btn.id as DirectoryTreeFilter)}
                className={cn(
                  "rounded-[8px] px-4 py-2 text-[13px] font-semibold transition-colors",
                  filter === btn.id
                    ? "border border-on-surface/8 bg-surface-container-lowest text-primary"
                    : "text-ui-muted hover:text-on-surface",
                )}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
        <DirectoryTreeDiff before={beforeTree} after={afterTree} filter={filter} />
      </section>

      {(hasErrors || hasWarnings || reviewCount > 0) ? (
        <section className="space-y-3 rounded-[8px] border border-on-surface/8 bg-surface-container-low p-5 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-on-surface/40" />
            <h3 className="text-[15px] font-black tracking-tight text-on-surface">预检结果</h3>
          </div>

          {summary.blocking_errors.map((err, index) => (
            <div key={`${err}-${index}`} className="flex items-start gap-3 rounded-[10px] border border-error/15 bg-surface-container-lowest px-4 py-4">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
              <div>
                <p className="text-[14px] font-semibold text-on-surface">必须先处理</p>
                <p className="mt-1 text-[13px] leading-6 text-ui-muted">{err}</p>
              </div>
            </div>
          ))}

          {summary.warnings.map((warn, index) => (
            <div key={`${warn}-${index}`} className="flex items-start gap-3 rounded-[10px] border border-warning/15 bg-surface-container-lowest px-4 py-4">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="text-[14px] font-semibold text-on-surface">建议执行前确认</p>
                <p className="mt-1 text-[13px] leading-6 text-ui-muted">{warn}</p>
              </div>
            </div>
          ))}

          {reviewCount > 0 ? (
            <div className="flex items-start gap-3 rounded-[10px] border border-primary/15 bg-surface-container-lowest px-4 py-4">
              <FolderPlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-[14px] font-semibold text-on-surface">Review 提醒</p>
                <p className="mt-1 text-[13px] leading-6 text-ui-muted">
                  这次有 {reviewCount} 项会先进入 `Review`。这些内容不会丢失，之后仍可继续整理或重新归类。
                </p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-[8px] border border-primary/12 bg-primary/6 p-5 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-primary text-white">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[12px] font-medium text-primary/80">后续操作</p>
            <h4 className="mt-1 text-[15px] font-black tracking-tight text-on-surface">{readOnly ? "这是之前的只读结果" : "确认执行这次整理吗？"}</h4>
            <p className="mt-1 text-[13px] leading-6 text-ui-muted">
              {readOnly
                ? "这里只用于查看之前的预检结果。如需继续整理，请回到首页重新选择。"
                : "执行后会真实移动本地文件。如果结果不合适，之后仍然可以按最近一次执行记录回退。"}
            </p>
          </div>
        </div>

        {!readOnly ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onBack}
              disabled={isBusy}
              className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-5 py-4 text-[13px] font-medium text-on-surface-variant transition-colors hover:bg-white hover:text-on-surface disabled:opacity-40"
            >
              返回继续修改
            </button>
            <button
              type="button"
              onClick={onRequestExecute}
              disabled={isBusy || hasErrors}
              className="inline-flex flex-1 items-center justify-center gap-3 rounded-[10px] border border-primary/20 bg-primary px-5 py-4 text-[13px] font-semibold text-white transition-colors hover:bg-primary-dim disabled:opacity-30"
            >
              <ArrowRight className="h-4 w-4" />
              确认执行
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
