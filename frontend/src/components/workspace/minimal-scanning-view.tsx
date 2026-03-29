"use client";

import { motion } from "framer-motion";
import { Loader2, Sparkles, StopCircle } from "lucide-react";

import { ScannerProgress } from "@/types/session";
import { Button } from "@/components/ui/button";

interface MinimalScanningViewProps {
  scanner: ScannerProgress;
  progressPercent: number;
  onAbort?: () => void;
  aborting?: boolean;
}

export function MinimalScanningView({ scanner, progressPercent, onAbort, aborting = false }: MinimalScanningViewProps) {
  const currentItem = scanner.current_item || "正在读取目录结构...";

  return (
    <div className="flex h-full w-full flex-col bg-transparent px-4 py-4 sm:px-5 sm:py-5 lg:px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="mx-auto flex h-full w-full max-w-[1240px] flex-col justify-center"
      >
        <div className="overflow-hidden rounded-[12px] border border-on-surface/8 bg-surface-container-lowest shadow-[0_18px_48px_rgba(0,0,0,0.04)]">
          <div className="border-b border-on-surface/8 bg-surface px-4 py-4 sm:px-5 lg:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Scanning
                </div>
                <h2 className="text-[1.2rem] font-black tracking-tight text-on-surface sm:text-[1.3rem] lg:text-[1.55rem]">
                  正在扫描并分析目录资料
                </h2>
                <p className="max-w-2xl text-[14px] leading-7 text-ui-muted">
                  系统正在建立目录结构、抽取可读内容并补充用途判断。扫描完成后会自动生成第一版整理方案。
                </p>
              </div>

              <div className="grid gap-3 xl:min-w-[360px] xl:grid-cols-2">
                <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                  <p className="text-[12px] font-medium text-ui-muted">当前处理项</p>
                  <p className="mt-2 break-all text-[14px] font-semibold text-on-surface">{currentItem}</p>
                </div>
                <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                  <p className="text-[12px] font-medium text-ui-muted">扫描进度</p>
                  <p className="mt-2 text-[1.6rem] font-black tracking-tight text-on-surface">{Math.round(progressPercent)}%</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 px-4 py-4 sm:px-5 sm:py-5 xl:grid-cols-[minmax(0,1fr)_280px] lg:px-6">
            <div className="rounded-[10px] border border-on-surface/8 bg-surface px-4 py-4">
              <div className="relative mb-5 flex h-14 items-center">
                <div className="absolute inset-y-0 left-0 flex items-center">
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary/6">
                    <div className="absolute inset-0 animate-ping rounded-full bg-primary/10 opacity-30" style={{ animationDuration: "2s" }} />
                    <Loader2 className="h-6 w-6 animate-spin text-primary/60 stroke-[2.5px]" />
                    <Sparkles className="absolute -right-1 -top-1 h-4.5 w-4.5 text-primary/40 animate-pulse" />
                  </div>
                </div>
                <div className="ml-16 flex-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-on-surface/6">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(2, progressPercent)}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 min-[1180px]:grid-cols-3">
                <div className="rounded-[10px] border border-on-surface/6 bg-surface-container-low px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ui-muted">阶段</p>
                  <p className="mt-2 text-[13px] font-semibold text-on-surface">建立扫描范围</p>
                </div>
                <div className="rounded-[10px] border border-on-surface/6 bg-surface-container-low px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ui-muted">内容</p>
                  <p className="mt-2 text-[13px] font-semibold text-on-surface">读取摘要与用途</p>
                </div>
                <div className="rounded-[10px] border border-on-surface/6 bg-surface-container-low px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ui-muted">下一步</p>
                  <p className="mt-2 text-[13px] font-semibold text-on-surface">自动生成整理草案</p>
                </div>
              </div>
            </div>

            <div className="rounded-[10px] border border-on-surface/8 bg-surface px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ui-muted">Control</p>
              <p className="mt-3 text-[13px] leading-6 text-ui-muted">
                扫描过程中不需要切换页面。系统会在完成后自动进入下一阶段。
              </p>
              {onAbort ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onAbort}
                  disabled={aborting}
                  className="mt-5 w-full justify-center"
                >
                  <StopCircle className="h-4 w-4" />
                  {aborting ? "正在中断..." : "中断本次扫描"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
