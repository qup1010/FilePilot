"use client";

import { motion } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";

import { ScannerProgress } from "@/types/session";

interface MinimalScanningViewProps {
  scanner: ScannerProgress;
  progressPercent: number;
}

export function MinimalScanningView({ scanner, progressPercent }: MinimalScanningViewProps) {
  const currentItem = scanner.current_item || "正在读取目录结构...";

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-surface px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex mt-[-10vh] max-w-md flex-col items-center text-center"
      >
        <div className="relative mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-primary/5">
          <div className="absolute inset-0 animate-ping rounded-full bg-primary/10 opacity-30" style={{ animationDuration: '2s' }} />
          <Loader2 className="h-10 w-10 animate-spin text-primary/60 stroke-[2.5px]" />
          <Sparkles className="absolute -right-1 -top-1 h-6 w-6 text-primary/40 animate-pulse" />
        </div>

        <h2 className="text-[20px] font-black tracking-tight text-on-surface">
          正在扫描并分析目录资料
        </h2>
        <div className="mt-3 space-y-1">
          <p className="text-[14px] leading-relaxed text-ui-muted font-medium">
            助手正在深入读取目录与文件特征...
          </p>
          <p className="text-[12px] text-ui-muted/70">
            扫描完成后，AI 将根据内容自动给出第一版整理方案。
          </p>
        </div>

        <div className="mt-10 flex w-full max-w-[280px] flex-col">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-on-surface/5">
            <motion.div
              className="h-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(2, progressPercent)}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <div className="mt-4 flex items-center justify-between px-1">
            <p className="truncate text-[11px] font-medium text-ui-muted">
              {currentItem}
            </p>
            <span className="ml-3 shrink-0 text-[11px] font-bold text-primary">
              {Math.round(progressPercent)}%
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
