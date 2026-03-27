"use client";

import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileSearch,
  FolderTree,
  Image as ImageIcon,
  Layers3,
  Loader2,
  ScanSearch,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { RecentAnalysisItem, ScannerProgress } from "@/types/session";

interface ScanningOverlayProps {
  scanner: ScannerProgress;
  progressPercent: number;
}

function getStatusMeta(scanner: ScannerProgress, progressPercent: number) {
  const status = scanner.status === "failed" ? "error" : scanner.status === "completed" ? "success" : "scanning";
  const processedCount = scanner.processed_count || 0;
  const totalCount = scanner.total_count || 0;
  const batchCount = Math.max(1, scanner.batch_count || 1);
  const completedBatches = Math.max(0, Math.min(batchCount, scanner.completed_batches || 0));
  const isParallel = batchCount > 1;

  if (status === "error") {
    return {
      status,
      title: "扫描已中断",
      description: scanner.message || "扫描过程中遇到异常，请返回上一步重试。",
      stageLabel: "等待重新开始",
      tone: "error" as const,
      helper: "当前不会执行任何落盘操作，重新扫描即可恢复正常流程。",
      batchSummary: isParallel ? `已完成 ${completedBatches}/${batchCount} 个批次` : `已触达 ${processedCount}/${totalCount || "?"} 个条目`,
    };
  }

  if (status === "success") {
    return {
      status,
      title: "扫描完成，正在生成初始草案",
      description: "元数据提取已经完成，系统正在把扫描结果整理成第一版可修改方案。",
      stageLabel: "汇总扫描结果",
      tone: "success" as const,
      helper: "接下来会自动进入整理方案阶段，仍不会直接移动文件。",
      batchSummary: isParallel ? `已完成 ${batchCount}/${batchCount} 个批次` : `已完成 ${processedCount}/${totalCount || processedCount} 个条目`,
    };
  }

  if (progressPercent < 20) {
    return {
      status,
      title: "正在读取目录结构",
      description: scanner.message || "系统先识别目录层级、文件名和基础元信息，建立这次整理的扫描范围。",
      stageLabel: "目录结构读取",
      tone: "progress" as const,
      helper: "这一阶段通常会快速经过；如果目录很大，首批结果可能会稍晚出现。",
      batchSummary: isParallel ? `准备并行分析 ${batchCount} 个批次` : `已发现 ${totalCount || "?"} 个待处理条目`,
    };
  }

  if (progressPercent < 50) {
    return {
      status,
      title: "正在抽取文件摘要",
      description: scanner.message || "系统正在读取文档与常见文件内容，用来判断用途和建议目录。",
      stageLabel: "摘要提取中",
      tone: "progress" as const,
      helper: "这里读取的是目录结构、文件名和内容摘要，不会直接执行移动或删除。",
      batchSummary: isParallel ? `已完成 ${completedBatches}/${batchCount} 个批次` : `已处理 ${processedCount}/${totalCount || "?"} 个条目`,
    };
  }

  if (progressPercent < 80) {
    return {
      status,
      title: "正在识别图片与用途",
      description: scanner.message || "系统正在结合文本、图片摘要和上下文，判断每个文件的大致用途。",
      stageLabel: "用途判断中",
      tone: "progress" as const,
      helper: "如果包含图片、扫描件或大文件，这一段可能会稍久一些。",
      batchSummary: isParallel ? `已完成 ${completedBatches}/${batchCount} 个批次` : `已分析 ${processedCount}/${totalCount || "?"} 个条目`,
    };
  }

  return {
    status,
    title: "正在汇总初始整理线索",
    description: scanner.message || "扫描已接近完成，系统正在汇总最近结果，准备生成第一版整理建议。",
    stageLabel: "草案准备中",
    tone: "progress" as const,
    helper: "只要仍有新结果出现或进度继续变化，就表示扫描还在正常推进。",
    batchSummary: isParallel ? `已完成 ${completedBatches}/${batchCount} 个批次` : `已处理 ${processedCount}/${totalCount || "?"} 个条目`,
  };
}

function getItemSummary(item: RecentAnalysisItem) {
  if (item.summary) {
    return item.summary.length > 42 ? `${item.summary.slice(0, 42)}...` : item.summary;
  }
  return "正在等待摘要结果";
}

function getPhaseIndex(status: ScannerProgress["status"], progressPercent: number) {
  if (status === "failed") return 0;
  if (status === "completed") return 3;
  if (progressPercent < 20) return 0;
  if (progressPercent < 50) return 1;
  if (progressPercent < 80) return 2;
  return 3;
}

export function ScanningOverlay({ scanner, progressPercent }: ScanningOverlayProps) {
  const processedCount = scanner.processed_count || 0;
  const totalCount = scanner.total_count || 0;
  const recentItems = [...(scanner.recent_analysis_items || [])].slice(-6).reverse();
  const currentItem = scanner.current_item || recentItems[0]?.display_name || "正在准备扫描";
  const meta = getStatusMeta(scanner, progressPercent);
  const clampedPercent = Math.max(0, Math.min(100, Math.round(progressPercent)));
  const batchCount = Math.max(1, scanner.batch_count || 1);
  const completedBatches = Math.max(0, Math.min(batchCount, scanner.completed_batches || 0));
  const isParallel = batchCount > 1;
  const activityLabel =
    scanner.status === "completed"
      ? "最近一轮已完成"
      : scanner.status === "failed"
        ? "等待重新开始"
        : recentItems.length > 0
          ? "最近结果仍在持续刷新"
          : "正在等待首批结果";
  const phaseIndex = getPhaseIndex(scanner.status, clampedPercent);
  const phases = [
    {
      label: "读取目录",
      detail: "识别文件夹层级和待分析条目",
      icon: FolderTree,
    },
    {
      label: "抽取摘要",
      detail: "读取文本与文件元信息",
      icon: FileSearch,
    },
    {
      label: "判断用途",
      detail: "结合内容与上下文生成用途判断",
      icon: Sparkles,
    },
    {
      label: scanner.status === "completed" ? "草案生成" : "结果汇总",
      detail: "整理最近结果，准备进入方案阶段",
      icon: Layers3,
    },
  ];
  const completionText = totalCount > 0 ? `${processedCount} / ${totalCount}` : `${processedCount}`;
  const boardTone =
    meta.tone === "error"
      ? "from-error/10 via-error/5 to-transparent"
      : meta.tone === "success"
        ? "from-emerald-500/10 via-emerald-500/5 to-transparent"
        : "from-primary/10 via-primary/5 to-transparent";
  const accentTone =
    meta.tone === "error"
      ? "bg-error/10 text-error"
      : meta.tone === "success"
        ? "bg-emerald-500/12 text-emerald-700"
        : "bg-primary/10 text-primary";

  return (
    <div className="flex h-full w-full items-center justify-center bg-surface px-4 py-4 lg:px-5">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex h-full min-h-[720px] w-full max-w-[1480px] flex-col overflow-hidden rounded-[16px] border border-black/5 bg-surface-container-lowest shadow-[0_12px_32px_rgba(24,26,31,0.05)]"
      >
        <div className="border-b border-black/5 bg-surface-container-low px-5 py-4 lg:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-4">
              <div
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border",
                  meta.tone === "error"
                    ? "border-error/15 bg-error/8 text-error"
                    : meta.tone === "success"
                      ? "border-emerald-500/15 bg-emerald-500/8 text-emerald-600"
                      : "border-primary/12 bg-primary/8 text-primary",
                )}
              >
                {meta.tone === "error" ? <AlertCircle className="h-5 w-5" /> : meta.tone === "success" ? <CheckCircle2 className="h-5 w-5" /> : <ScanSearch className="h-5 w-5" />}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-full px-3 py-1 text-[11px] font-semibold", accentTone)}>{meta.stageLabel}</span>
                  <span className="rounded-full bg-black/[0.04] px-3 py-1 text-[11px] font-medium text-ui-muted">{meta.batchSummary}</span>
                </div>
                <h2 className="mt-3 text-[1.35rem] font-black tracking-tight text-on-surface">{meta.title}</h2>
                <p className="mt-2 max-w-3xl text-[13px] leading-6 text-ui-muted">{meta.description}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[430px]">
              <div className="rounded-[12px] border border-black/5 bg-surface px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ui-muted">
                  <Clock3 className="h-3.5 w-3.5" />
                  扫描进度
                </div>
                <p className="mt-3 text-[1.55rem] font-black tabular-nums text-on-surface">{clampedPercent}%</p>
              </div>
              <div className="rounded-[12px] border border-black/5 bg-surface px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ui-muted">
                  <Layers3 className="h-3.5 w-3.5" />
                  条目统计
                </div>
                <p className="mt-3 text-[1.2rem] font-black tabular-nums text-on-surface">{completionText}</p>
              </div>
              <div className="rounded-[12px] border border-black/5 bg-surface px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ui-muted">
                  <FolderTree className="h-3.5 w-3.5" />
                  批次状态
                </div>
                <p className="mt-3 text-[1.2rem] font-black tabular-nums text-on-surface">{isParallel ? `${completedBatches}/${batchCount}` : "单批次"}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/[0.05]">
            <motion.div
              className={cn("h-full rounded-full", meta.tone === "error" ? "bg-error" : meta.tone === "success" ? "bg-emerald-500" : "bg-primary")}
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(6, clampedPercent)}%` }}
              transition={{ duration: 0.35 }}
            />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-h-0 border-b border-black/5 px-5 py-5 xl:border-b-0 xl:border-r lg:px-6">
            <div className="rounded-[16px] border border-black/5 bg-surface px-4 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ui-muted">当前处理项</p>
              <p className="mt-3 break-all text-[15px] font-semibold leading-7 text-on-surface">{currentItem}</p>
              <p className="mt-2 text-[12px] leading-6 text-ui-muted">{meta.helper}</p>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ui-muted">
                  <FileSearch className="h-4 w-4 text-primary" />
                  最近分析结果
                </div>
                <span className="text-[11px] text-ui-muted">{activityLabel}</span>
              </div>

              {recentItems.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {recentItems.map((item, index) => (
                    <motion.div
                      key={`${item.item_id}-${index}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.04 }}
                      className="rounded-[14px] border border-black/5 bg-surface px-4 py-3.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-on-surface">{item.display_name}</p>
                          <p className="mt-1 truncate text-[12px] text-ui-muted">{item.source_relpath}</p>
                        </div>
                        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", index === 0 ? accentTone : "bg-black/[0.04] text-on-surface-variant/70")}>
                          {index === 0 ? "最新" : "已分析"}
                        </span>
                      </div>
                      <p className="mt-3 text-[12px] leading-6 text-on-surface-variant">{getItemSummary(item)}</p>
                      {item.suggested_purpose ? (
                        <div className="mt-3 inline-flex rounded-full bg-primary/8 px-2.5 py-1 text-[11px] font-medium text-primary">
                          {item.suggested_purpose}
                        </div>
                      ) : null}
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 flex min-h-[220px] items-center justify-center rounded-[16px] border border-dashed border-black/8 bg-surface-container-low/45">
                  <div className="text-center">
                    <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary/35" />
                    <p className="mt-3 text-[14px] font-semibold text-on-surface">正在等待首批扫描结果</p>
                    <p className="mt-2 max-w-sm text-[12px] leading-6 text-ui-muted">
                      当目录结构读取完成后，这里会开始显示最近处理过的文件和摘要。
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside className="flex min-h-0 flex-col bg-surface-container-low/28 px-5 py-5 lg:px-6">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ui-muted">
              <ShieldCheck className="h-4 w-4 text-primary" />
              扫描轨迹
            </div>
            <div className="mt-4 space-y-4">
              {phases.map((phase, index) => {
                const Icon = phase.icon;
                const isActive = index === phaseIndex;
                const isDone = scanner.status !== "failed" && index < phaseIndex;
                return (
                  <div key={phase.label} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full border",
                          isDone
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
                            : isActive
                              ? "border-primary/20 bg-primary/10 text-primary"
                              : "border-black/6 bg-black/[0.03] text-on-surface-variant/60",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      {index < phases.length - 1 ? <div className="mt-2 h-7 w-px bg-black/8" /> : null}
                    </div>
                    <div className="pt-0.5">
                      <p className="text-[13px] font-semibold text-on-surface">{phase.label}</p>
                      <p className="mt-1 text-[12px] leading-5 text-ui-muted">{phase.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 space-y-3">
              <div className="rounded-[14px] border border-black/5 bg-surface px-4 py-4">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ui-muted">
                  <ImageIcon className="h-3.5 w-3.5 text-primary" />
                  复杂文件
                </div>
                <p className="mt-3 text-[12px] leading-6 text-on-surface-variant">
                  图片、扫描件、压缩包和大文件会拖长扫描时间，因为系统需要补充摘要和用途判断。
                </p>
              </div>
              <div className="rounded-[14px] border border-black/5 bg-surface px-4 py-4">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ui-muted">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  安全边界
                </div>
                <p className="mt-3 text-[12px] leading-6 text-on-surface-variant">
                  当前只读取信息，不会执行移动或删除。扫描完成后还会先做预检，再由你最终确认。
                </p>
              </div>
            </div>
          </aside>
        </div>
      </motion.div>
    </div>
  );
}
