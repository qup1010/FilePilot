"use client";

import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileSearch,
  Loader2,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ScannerProgress } from "@/types/session";

interface ScanningOverlayProps {
  scanner: ScannerProgress;
  progressPercent: number;
}

function getStatusMeta(scanner: ScannerProgress, progressPercent: number) {
  const status = scanner.status === "failed" ? "error" : scanner.status === "completed" ? "success" : "scanning";

  if (status === "error") {
    return {
      status,
      title: "扫描已中断",
      description: scanner.message || "扫描过程中遇到异常，请返回上一步重试。",
      tone: "error" as const,
    };
  }

  if (status === "success") {
    return {
      status,
      title: "扫描完成，正在整理结果",
      description: "元数据提取已经完成，系统正在准备初始整理草案。",
      tone: "success" as const,
    };
  }

  if (progressPercent < 35) {
    return {
      status,
      title: "正在读取目录结构",
      description: "系统会先识别文件名、层级和基础元信息，再逐步补充内容摘要。",
      tone: "progress" as const,
    };
  }

  if (progressPercent < 75) {
    return {
      status,
      title: "正在分析文件用途",
      description: "系统会结合文件名、摘要和上下文判断每个文件的大致用途。",
      tone: "progress" as const,
    };
  }

  return {
    status,
    title: "正在汇总整理线索",
    description: "扫描接近完成，系统正在把最近分析结果整理成可执行的初始方案。",
    tone: "progress" as const,
  };
}

export function ScanningOverlay({ scanner, progressPercent }: ScanningOverlayProps) {
  const processedCount = scanner.processed_count || 0;
  const totalCount = scanner.total_count || 0;
  const recentItems = [...(scanner.recent_analysis_items || [])].slice(-4).reverse();
  const currentItem = scanner.current_item || recentItems[0]?.display_name || "正在准备扫描";
  const meta = getStatusMeta(scanner, progressPercent);

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-center">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-[32px] border border-on-surface/6 bg-surface-container-lowest shadow-[0_30px_90px_rgba(24,32,28,0.08)]"
      >
        <div className="border-b border-on-surface/6 bg-linear-to-br from-surface to-surface-container-low px-10 py-9">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-5">
              <div
                className={cn(
                  "flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl border",
                  meta.tone === "error"
                    ? "border-error/15 bg-error/8 text-error"
                    : meta.tone === "success"
                      ? "border-emerald-500/15 bg-emerald-500/8 text-emerald-600"
                      : "border-primary/12 bg-primary/8 text-primary"
                )}
              >
                {meta.tone === "error" ? (
                  <AlertCircle className="h-8 w-8" />
                ) : meta.tone === "success" ? (
                  <CheckCircle2 className="h-8 w-8" />
                ) : (
                  <ScanSearch className="h-8 w-8" />
                )}
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-on-surface-variant/45">
                    扫描工作台
                  </p>
                  <h2 className="text-3xl font-black tracking-tight text-on-surface">{meta.title}</h2>
                  <p className="max-w-2xl text-sm leading-7 text-on-surface-variant">{meta.description}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-full border border-on-surface/8 bg-white px-4 py-2 text-xs font-bold text-on-surface">
                    已扫描 {processedCount} / {totalCount || "?"} 项
                  </div>
                  <div className="rounded-full border border-on-surface/8 bg-white px-4 py-2 text-xs font-bold text-on-surface-variant">
                    当前：{currentItem}
                  </div>
                </div>
              </div>
            </div>

            <div className="hidden min-w-[180px] rounded-3xl border border-on-surface/6 bg-white/90 px-5 py-4 lg:block">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-on-surface-variant/45">
                <Clock3 className="h-3.5 w-3.5" />
                实时进度
              </div>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-4xl font-black leading-none text-on-surface tabular-nums">
                  {Math.max(0, Math.min(100, Math.round(progressPercent)))}
                </span>
                <span className="pb-1 text-sm font-bold text-on-surface-variant">%</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-container-high">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(6, progressPercent)}%` }}
                  transition={{ duration: 0.35 }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="border-r border-on-surface/6 px-10 py-8">
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-on-surface-variant/45">
              <FileSearch className="h-4 w-4" />
              最近分析结果
            </div>

            {recentItems.length > 0 ? (
              <div className="mt-5 space-y-3">
                {recentItems.map((item, index) => (
                  <motion.div
                    key={`${item.item_id}-${index}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="rounded-2xl border border-on-surface/6 bg-surface px-5 py-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-on-surface">{item.display_name}</p>
                        <p className="mt-1 truncate text-xs text-on-surface-variant">{item.source_relpath}</p>
                      </div>
                      {item.suggested_purpose ? (
                        <span className="shrink-0 rounded-full bg-primary/8 px-3 py-1 text-[11px] font-bold text-primary">
                          {item.suggested_purpose}
                        </span>
                      ) : null}
                    </div>
                    {item.summary ? (
                      <p className="mt-3 text-sm leading-6 text-on-surface-variant">{item.summary}</p>
                    ) : null}
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="mt-5 flex min-h-[240px] flex-col items-center justify-center rounded-3xl border border-dashed border-on-surface/8 bg-surface text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
                <p className="mt-4 text-sm font-bold text-on-surface">正在等待首批扫描结果</p>
                <p className="mt-2 max-w-sm text-sm leading-6 text-on-surface-variant">
                  扫描开始后，这里会实时显示最近几个文件的用途判断和内容摘要。
                </p>
              </div>
            )}
          </div>

          <div className="px-10 py-8">
            <div className="rounded-3xl border border-on-surface/6 bg-surface px-6 py-6">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-on-surface-variant/45">
                <ShieldCheck className="h-4 w-4" />
                当前正在做什么
              </div>
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl bg-surface-container-low px-4 py-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/45">当前文件</p>
                  <p className="mt-2 text-sm font-bold text-on-surface break-all">{currentItem}</p>
                </div>
                <div className="rounded-2xl bg-surface-container-low px-4 py-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/45">扫描说明</p>
                  <p className="mt-2 text-sm leading-7 text-on-surface-variant">
                    当前阶段只读取目录结构、文件名和内容摘要，用来生成初始整理建议，不会直接移动或删除任何文件。
                  </p>
                </div>
                <div className="rounded-2xl bg-surface-container-low px-4 py-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/45">如果等待较久</p>
                  <p className="mt-2 text-sm leading-7 text-on-surface-variant">
                    如果长时间没有新的扫描结果，通常表示目录较大或读取受限。保留当前窗口即可；若最终失败，系统会自动进入可重试状态。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
