"use client";
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Loader2, 
  StopCircle, 
  Search, 
  FileText, 
  Activity,
  AlertCircle
} from "lucide-react";
import Link from "next/link";

import { ScannerProgress } from "@/types/session";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MinimalScanningViewProps {
  scanner: ScannerProgress;
  progressPercent: number;
  onAbort?: () => void;
  aborting?: boolean;
  isModelConfigured?: boolean;
}

export function MinimalScanningView({ 
  scanner, 
  progressPercent, 
  onAbort, 
  aborting = false,
  isModelConfigured = true 
}: MinimalScanningViewProps) {
  const currentItem = scanner.current_item || "正在读取目录...";
  const recentItems = scanner.recent_analysis_items || [];

  return (
    <div className="flex h-full w-full flex-col bg-transparent p-4 lg:p-6">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex h-full w-full max-w-[1360px] flex-col"
      >
        {!isModelConfigured && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-[10px] border border-warning/20 bg-warning-container/20 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/15 text-warning">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-[14px] font-black text-on-surface">AI 文本模型未配置</p>
                <p className="text-[12px] font-medium text-ui-muted">未配置模型将无法分析文件具体用途，建议前往“设置”页面完成配置。</p>
              </div>
            </div>
            <Link href="/settings">
              <Button variant="secondary" size="sm" className="whitespace-nowrap px-4 font-bold">
                去配置模型
              </Button>
            </Link>
          </div>
        )}
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
                <Search className="h-3.5 w-3.5" />
              </div>
              <h2 className="text-[14px] font-bold tracking-tight text-on-surface">
                正在扫描目录
              </h2>
            </div>
            <p className="text-[12px] text-ui-muted">
              正在读取目录结构和文件特征，完成后会自动进入方案整理。
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-[6px] border border-on-surface/8 bg-surface-container-lowest px-2.5 py-1">
              <span className="text-[11px] font-medium text-ui-muted">进度</span>
              <span className="text-[14px] font-bold tabular-nums text-on-surface">
                {Math.round(progressPercent)}%
              </span>
            </div>
            {onAbort && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onAbort}
                disabled={aborting}
                className="h-7 gap-1 rounded-[6px] text-[11px] font-medium text-error hover:bg-error/10 hover:text-error transition-colors"
              >
                <StopCircle className="h-3 w-3" />
                {aborting ? "停止中" : "中断"}
              </Button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="grid flex-1 gap-4 overflow-hidden lg:grid-cols-[1fr_280px]">
          <div className="flex flex-col gap-4 overflow-hidden">
            {/* Status */}
            <div className="rounded-[6px] border border-on-surface/8 bg-surface-container-lowest p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                  <h3 className="text-[12px] font-bold text-on-surface">
                    {scanner.message || "正在分析文件特征"}
                  </h3>
                </div>
              </div>

              <div className="mb-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ui-muted">
                    {scanner.processed_count} / {scanner.total_count} 已处理
                  </span>
                  <span className="truncate ml-4 max-w-[60%] text-ui-muted">
                    {currentItem}
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-on-surface/5">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(2, progressPercent)}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { label: "模式", value: "全量扫描" },
                  { label: "线程", value: scanner.batch_count ? `${scanner.batch_count} 并行` : "标准" },
                  { label: "阶段", value: "生成方案" },
                ].map((stat, idx) => (
                  <div key={idx} className="border-l border-on-surface/10 pl-3 py-0.5">
                    <p className="text-[10px] text-ui-muted uppercase tracking-tight">{stat.label}</p>
                    <p className="text-[12px] font-semibold text-on-surface truncate">{stat.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="flex flex-1 flex-col overflow-hidden rounded-[6px] border border-on-surface/8 bg-surface-container-lowest/50">
              <div className="flex items-center justify-between border-b border-on-surface/6 bg-surface-container-lowest px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface/50">
                  最近记录
                </span>
                <span className="text-[10px] text-success/70 font-medium">同步中</span>
              </div>
              
              <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5 scrollbar-none">
                <AnimatePresence initial={false}>
                  {recentItems.length > 0 ? (
                    recentItems.map((item, idx) => (
                      <motion.div
                        key={item.item_id + idx}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={cn(
                          "group flex items-center gap-2.5 rounded-[4px] border border-transparent px-2 py-1.5 transition-colors",
                          idx === 0 ? "bg-primary/[0.03] border-primary/10" : "bg-transparent hover:bg-on-surface/[0.02]"
                        )}
                      >
                        <FileText className={cn("h-3 w-3 shrink-0", idx === 0 ? "text-primary" : "text-on-surface/30")} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[12px] font-medium text-on-surface">
                              {item.display_name}
                            </p>
                            <span className="shrink-0 text-[10px] font-bold text-primary/60">
                              {item.suggested_purpose}
                            </span>
                          </div>
                          <p className="truncate text-[10px] text-ui-muted">{item.summary}</p>
                        </div>
                      </motion.div>
                    ))
                  ) : (
                    <div className="flex h-full items-center justify-center text-ui-muted opacity-30 py-8">
                  <p className="text-[11px]">正在等待扫描结果...</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="hidden flex-col gap-4 lg:flex">
            <div className="flex-1 rounded-[6px] border border-on-surface/8 bg-surface-container-low/10 p-4">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-on-surface/40 mb-4">
                说明
              </h4>
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-[12px] font-bold text-on-surface">自动分类</p>
                  <p className="text-[11px] leading-relaxed text-ui-muted">
                    系统根据文件摘要自动分类。超大文件仅读取元数据。
                  </p>
                </div>

                <div className="rounded-[4px] border border-on-surface/6 bg-surface-container-lowest p-3 text-[11px] text-ui-muted">
                  扫描完成后可直接查看第一版整理方案。
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
