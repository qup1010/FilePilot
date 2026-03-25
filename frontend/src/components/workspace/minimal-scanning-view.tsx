"use client";

import React from "react";
import { motion } from "framer-motion";
import { GitBranch, Layers3, Loader2 } from "lucide-react";

import { ScannerProgress } from "@/types/session";

interface MinimalScanningViewProps {
  scanner: ScannerProgress;
  progressPercent: number;
}

export function MinimalScanningView({ scanner, progressPercent }: MinimalScanningViewProps) {
  const currentItem = scanner.current_item || "正在准备扫描";
  const itemPercent = Math.max(0, Math.min(100, progressPercent));
  const isParallel = (scanner.batch_count || 0) > 1;
  const batchCount = Math.max(1, scanner.batch_count || 0);
  const completedBatches = Math.max(0, Math.min(batchCount, scanner.completed_batches || 0));
  const batchPercent = isParallel ? (completedBatches / batchCount) * 100 : itemPercent;
  const statusMessage = scanner.message || (isParallel ? "系统正在并行分析多个批次" : "AI 正在逐项分析文件元数据与用途");

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-surface p-20">
      <div className="w-full max-w-2xl space-y-10">
        <div className="space-y-4 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex justify-center"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-on-surface/5 bg-white text-primary shadow-xl shadow-primary/5">
              <Loader2 className="h-8 w-8 animate-spin-slow" />
            </div>
          </motion.div>

          <div className="space-y-1">
            <h2 className="font-headline text-xl font-black uppercase tracking-tight text-on-surface">
              正在同步目录结构
            </h2>
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-on-surface-variant/40">
              {statusMessage}
            </p>
            <div className="flex justify-center pt-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-primary/12 bg-primary/[0.06] px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-primary">
                {isParallel ? <GitBranch className="h-3 w-3" /> : <Layers3 className="h-3 w-3" />}
                {isParallel ? `并行分析 ${batchCount} 批` : "单线程分析"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-on-surface/6 bg-white/72 p-6 shadow-[0_18px_48px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">
                条目进度
              </span>
              <span className="text-sm font-black tabular-nums text-on-surface">
                {scanner.processed_count || 0}/{scanner.total_count || 0}
              </span>
            </div>
            <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-on-surface/5 text-xs">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(2, itemPercent)}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="flex flex-col justify-center whitespace-nowrap rounded-full bg-primary text-center text-white shadow-none"
              />
            </div>
            <p className="mt-4 text-sm leading-6 text-on-surface-variant">
              {isParallel
                ? "按已完成批次折算到条目总量，用来表示整体扫描覆盖度。"
                : "单线程模式下按已触达或已确认的条目持续推进，属于实时估算进度。"}
            </p>
          </div>

          <div className="rounded-xl border border-on-surface/6 bg-white/72 p-6 shadow-[0_18px_48px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">
                {isParallel ? "批次进度" : "当前状态"}
              </span>
              <span className="text-sm font-black tabular-nums text-on-surface">
                {isParallel ? `${completedBatches}/${batchCount}` : `${Math.round(itemPercent)}%`}
              </span>
            </div>
            <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-on-surface/5 text-xs">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(2, batchPercent)}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="flex flex-col justify-center whitespace-nowrap rounded-full bg-on-surface text-center text-white shadow-none"
              />
            </div>
            <p className="mt-4 text-sm leading-6 text-on-surface-variant">
              {isParallel
                ? "每个批次完成后都会立即更新；批次越多，模型等待时间通常也会更长。"
                : "如果当前目录较大，模型会在单线程里持续读取文件并逐步汇总结果。"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-on-surface/5 bg-white/50 p-5 transition-all">
          <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">
              当前正在处理
            </p>
            <p className="break-all text-[14px] font-bold text-on-surface">{currentItem}</p>
          </div>
        </div>

        <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/20">
          扫描完成后，系统会自动继续生成第一版整理建议
        </p>
      </div>
    </div>
  );
}
