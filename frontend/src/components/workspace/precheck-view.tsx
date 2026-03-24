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

  const beforeTree = {
    title: "整理前目录树",
    subtitle: "基于当前扫描结果中的原始路径，还原这次会被处理的条目结构。",
    leafEntries: summary.move_preview.map((move) => ({ path: move.source })),
    emptyLabel: "当前没有可预检的原始路径。",
  };

  const afterTree = {
    title: "整理后目录树",
    subtitle: "这是预检通过后将要形成的目标结构，下一步仍只做真实文件系统检查，不会立即执行移动。",
    leafEntries: summary.move_preview.map<DirectoryTreeLeafEntry>((move) => ({
      path: move.target,
      status: move.target.split(/[\\/]/).some((part) => part.toLowerCase() === "review") ? "review" : "pending",
    })),
    directoryEntries: summary.mkdir_preview,
    emptyLabel: "当前没有可展示的目标目录结构。",
  };

  return (
    <div className="mx-auto max-w-6xl space-y-10 py-6">
      <div className="flex flex-col gap-6 rounded-[2rem] border border-on-surface/6 bg-white/76 p-8 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/6 px-3 py-1 text-[11px] font-bold text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            草案满足预检条件
          </div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-on-surface">整理草案已满足预检条件</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-on-surface-variant">
              当前待确认项已经清空，结构校验也已通过。下一步将检查真实文件系统冲突与路径可写性，不会立即执行文件移动。
            </p>
          </div>
        </div>

        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold shadow-sm",
            hasErrors
              ? "border-error/20 bg-error-container/15 text-error"
              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600",
          )}
        >
          {hasErrors ? <ShieldAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          {hasErrors ? "预检存在阻塞风险" : "结构校验已通过"}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[1.5rem] border border-on-surface/6 bg-white/78 p-5 shadow-sm">
          <div className="flex items-center gap-3 text-primary">
            <FolderPlus className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-widest">目标目录</span>
          </div>
          <p className="mt-4 text-3xl font-black text-on-surface">{summary.mkdir_preview.length}</p>
          <p className="mt-2 text-xs leading-5 text-on-surface-variant">预检阶段将创建或使用这些目录来承接整理后的结构。</p>
        </div>

        <div className="rounded-[1.5rem] border border-on-surface/6 bg-white/78 p-5 shadow-sm">
          <div className="flex items-center gap-3 text-primary">
            <ArrowRight className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-widest">涉及移动</span>
          </div>
          <p className="mt-4 text-3xl font-black text-on-surface">{summary.move_preview.length}</p>
          <p className="mt-2 text-xs leading-5 text-on-surface-variant">这些条目会在执行阶段按右侧目录树落位。</p>
        </div>

        <div className="rounded-[1.5rem] border border-warning/12 bg-warning-container/10 p-5 shadow-sm">
          <div className="flex items-center gap-3 text-warning">
            <ShieldAlert className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-widest">Review 项</span>
          </div>
          <p className="mt-4 text-3xl font-black text-on-surface">{reviewCount}</p>
          <p className="mt-2 text-xs leading-5 text-on-surface-variant">这些条目会保留在 `Review` 下，方便后续人工确认。</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-end justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-on-surface">目录树前后对比</h3>
            <p className="text-sm text-on-surface-variant">左侧是当前目录中的原始结构，右侧是预检通过后将形成的目标结构。</p>
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

      {(hasErrors || hasWarnings) ? (
        <div className="space-y-4 rounded-[1.75rem] border border-on-surface/6 bg-surface-container-low/45 p-6">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-on-surface/35" />
            <h3 className="text-sm font-bold text-on-surface">真实文件系统风险检查</h3>
          </div>

          <div className="space-y-3">
            {summary.blocking_errors.map((err, index) => (
              <div key={`${err}-${index}`} className="flex items-start gap-3 rounded-2xl border border-error/15 bg-white px-4 py-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
                <div>
                  <p className="text-sm font-bold text-on-surface">阻塞性问题</p>
                  <p className="mt-1 text-sm leading-6 text-on-surface-variant">{err}</p>
                </div>
              </div>
            ))}

            {summary.warnings.map((warn, index) => (
              <div key={`${warn}-${index}`} className="flex items-start gap-3 rounded-2xl border border-warning/15 bg-white px-4 py-4">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div>
                  <p className="text-sm font-bold text-on-surface">预警提示</p>
                  <p className="mt-1 text-sm leading-6 text-on-surface-variant">{warn}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-5 rounded-[1.75rem] border border-primary/10 bg-primary/6 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-white">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-on-surface">{readOnly ? "当前是旧会话只读视图" : "确认执行这次目录重组？"}</h4>
            <p className="mt-1 text-sm leading-6 text-on-surface-variant">
              {readOnly
                ? "这里只用于查看旧草案的预检结果。如需继续整理，请返回启动页选择恢复旧会话或重新开始。"
                : "执行后会物理移动本地文件。如果结果不符合预期，仍可在完成页使用整批回退功能撤销本次整理。"}
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
              返回继续修改草案
            </button>
            <button
              type="button"
              onClick={() => onExecute(true)}
              disabled={isBusy || hasErrors}
              className="inline-flex flex-1 items-center justify-center gap-3 rounded-2xl bg-primary px-5 py-4 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-30"
            >
              <ArrowRight className="h-4 w-4" />
              确认执行整理
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
