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

  return (
    <div className="flex h-full w-full items-center justify-center bg-surface px-5 py-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[1360px] overflow-hidden rounded-[14px] border border-on-surface/8 bg-surface-container-lowest shadow-[0_16px_42px_rgba(24,32,28,0.08)]"
      >
        <div className="border-b border-on-surface/8 bg-surface-container-low px-6 py-5 lg:px-7">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-4">
              <div
                className={cn(
                  "flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] border",
                  meta.tone === "error"
                    ? "border-error/15 bg-error/8 text-error"
                    : meta.tone === "success"
                      ? "border-emerald-500/15 bg-emerald-500/8 text-emerald-600"
                      : "border-primary/12 bg-primary/8 text-primary",
                )}
              >
                {meta.tone === "error" ? (
                  <AlertCircle className="h-7 w-7" />
                ) : meta.tone === "success" ? (
                  <CheckCircle2 className="h-7 w-7" />
                ) : (
                  <ScanSearch className="h-7 w-7" />
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">
                    {meta.stageLabel}
                  </div>
                  <div className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-3 py-1 text-[12px] font-medium text-on-surface-variant">
                    {meta.batchSummary}
                  </div>
                </div>
                <h2 className="text-[1.35rem] font-black tracking-tight text-on-surface lg:text-[1.55rem]">{meta.title}</h2>
                <p className="max-w-3xl text-[14px] leading-7 text-ui-muted">{meta.description}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ui-muted">
                  <Clock3 className="h-3.5 w-3.5" />
                  扫描进度
                </div>
                <p className="mt-3 text-[1.7rem] font-black tabular-nums text-on-surface">{clampedPercent}%</p>
                <p className="mt-2 text-[12px] leading-5 text-on-surface-variant/65">{activityLabel}</p>
              </div>
              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ui-muted">
                  <Layers3 className="h-3.5 w-3.5" />
                  条目统计
                </div>
                <p className="mt-3 text-[1.1rem] font-black tabular-nums text-on-surface">
                  {processedCount}/{totalCount || "?"}
                </p>
              </div>
              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ui-muted">
                  <FolderTree className="h-3.5 w-3.5" />
                  批次状态
                </div>
                <p className="mt-3 text-[1.1rem] font-black tabular-nums text-on-surface">
                  {isParallel ? `${completedBatches}/${batchCount}` : "单批次"}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-container-high">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(6, progressPercent)}%` }}
              transition={{ duration: 0.35 }}
            />
          </div>
        </div>

        <div className="grid gap-0 xl:grid-cols-[0.84fr_1.2fr_0.96fr]">
          <div className="border-b border-on-surface/8 px-6 py-5 xl:border-b-0 xl:border-r xl:px-7">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ui-muted">
              <Layers3 className="h-4 w-4 text-primary" />
              当前阶段
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-4">
                <p className="text-[12px] font-medium text-ui-muted">阶段说明</p>
                <p className="mt-2 text-[13px] leading-7 text-on-surface">{meta.helper}</p>
              </div>
              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-4">
                <p className="text-[12px] font-medium text-ui-muted">处理模式</p>
                <p className="mt-2 text-[13px] font-semibold text-on-surface">
                  {isParallel ? `并行分析 ${batchCount} 个批次` : "顺序扫描单批次"}
                </p>
                <p className="mt-2 text-[12px] leading-6 text-ui-muted">
                  {isParallel ? "批次完成后会立刻刷新最近结果与整体覆盖度。" : "每处理完一批条目，进度和最近结果都会继续推进。"}
                </p>
              </div>
              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-4">
                <p className="text-[12px] font-medium text-ui-muted">等待建议</p>
                <p className="mt-2 text-[12px] leading-6 text-ui-muted">
                  如果目录很大、文件较多或包含图片与扫描件，扫描时间会更长。保持窗口打开即可，不会因为等待而提前执行文件移动。
                </p>
              </div>
            </div>
          </div>

          <div className="border-b border-on-surface/8 px-6 py-5 xl:border-b-0 xl:border-r xl:px-7">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ui-muted">
              <FileSearch className="h-4 w-4 text-primary" />
              当前处理项与最近结果
            </div>

            <div className="mt-4 rounded-[10px] border border-primary/12 bg-primary/6 px-4 py-4">
              <p className="text-[12px] font-medium text-primary/80">当前处理项</p>
              <p className="mt-2 break-all text-[14px] font-semibold text-on-surface">{currentItem}</p>
              <p className="mt-2 text-[12px] leading-6 text-ui-muted">这里只显示当前卡住或正在读取的条目，便于判断扫描停留在哪一步。</p>
            </div>

            {recentItems.length > 0 ? (
              <div className="mt-4 space-y-3">
                {recentItems.map((item, index) => (
                  <motion.div
                    key={`${item.item_id}-${index}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3.5"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          index === 0 ? "bg-primary/10 text-primary" : "bg-surface-container-low text-on-surface-variant/70",
                        )}
                      >
                        {index === 0 ? "刚完成" : "已分析"}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-on-surface">{item.display_name}</p>
                        <p className="mt-1 truncate text-[12px] text-ui-muted">{item.source_relpath}</p>
                      </div>
                      {item.suggested_purpose ? (
                        <span className="shrink-0 rounded-full bg-primary/8 px-2.5 py-1 text-[11px] font-medium text-primary">
                          {item.suggested_purpose}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 text-[12px] leading-6 text-on-surface-variant">{getItemSummary(item)}</p>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="mt-4 flex min-h-[280px] flex-col items-center justify-center rounded-[12px] border border-dashed border-on-surface/8 bg-surface-container-low text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
                <p className="mt-4 text-[14px] font-semibold text-on-surface">正在等待首批扫描结果</p>
                <p className="mt-2 max-w-sm text-[13px] leading-6 text-ui-muted">
                  首批结果出来后，这里会滚动显示最近已分析完成的文件、路径和一行摘要。
                </p>
              </div>
            )}
          </div>

          <div className="px-6 py-5 xl:px-7">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ui-muted">
              <ShieldCheck className="h-4 w-4 text-primary" />
              扫描说明
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-4">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ui-muted">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  当前系统在做什么
                </div>
                <p className="mt-3 text-[13px] leading-7 text-on-surface">
                  {meta.description}
                </p>
              </div>
              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-4">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ui-muted">
                  <ImageIcon className="h-3.5 w-3.5 text-primary" />
                  图片与复杂文件
                </div>
                <p className="mt-3 text-[12px] leading-6 text-ui-muted">
                  如果目录里包含图片、扫描件、压缩包或大体积文件，扫描过程通常会更慢，这是因为系统需要补充摘要和用途判断。
                </p>
              </div>
              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-4">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ui-muted">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  安全边界
                </div>
                <p className="mt-3 text-[12px] leading-6 text-ui-muted">
                  扫描阶段只读取目录结构、文件名和内容摘要，用来生成第一版整理建议。真正落盘前，还会经过预检和最终确认。
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
