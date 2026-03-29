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
  StopCircle,
  Sparkles,
  Search,
  Activity,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { RecentAnalysisItem, ScannerProgress } from "@/types/session";

interface ScanningOverlayProps {
  scanner: ScannerProgress;
  progressPercent: number;
  onAbort?: () => void;
  aborting?: boolean;
}

function getStatusMeta(scanner: ScannerProgress, progressPercent: number) {
  const status = scanner.status === "failed" ? "error" : scanner.status === "completed" ? "success" : "scanning";

  if (status === "error") {
    return {
      title: "扫描已中断",
      description: scanner.message || "扫描过程中遇到异常，请重试。",
      stageLabel: "等待重试",
      tone: "error" as const,
      helper: "重新扫描即可恢复正常流程。",
    };
  }

  if (status === "success") {
    return {
      title: "扫描完成，正在汇总",
      description: "元数据提取已完成，正在生成初始草案。",
      stageLabel: "结果汇总",
      tone: "success" as const,
      helper: "接下来将自动进入整理建议阶段。",
    };
  }

  return {
    title: progressPercent < 30 ? "正在读取目录结构" : progressPercent < 70 ? "正在抽取文件摘要" : "正在识别图片与用途",
    description: scanner.message || "系统正在读取文件内容并判断用途。",
    stageLabel: progressPercent < 30 ? "目录读取" : progressPercent < 70 ? "摘要分析" : "用途识别",
    tone: "progress" as const,
    helper: "系统正在逐项分析文件内容和用途，请稍候。",
  };
}

function getItemSummary(item: RecentAnalysisItem) {
  if (item.summary) {
    return item.summary.length > 50 ? `${item.summary.slice(0, 50)}...` : item.summary;
  }
  return "正在生成摘要...";
}

function getPhaseIndex(status: ScannerProgress["status"], progressPercent: number) {
  if (status === "failed") return 0;
  if (status === "completed") return 3;
  if (progressPercent < 30) return 0;
  if (progressPercent < 60) return 1;
  if (progressPercent < 90) return 2;
  return 3;
}

export function ScanningOverlay({ scanner, progressPercent, onAbort, aborting = false }: ScanningOverlayProps) {
  const meta = getStatusMeta(scanner, progressPercent);
  const clampedPercent = Math.max(0, Math.min(100, Math.round(progressPercent)));
  const recentItems = [...(scanner.recent_analysis_items || [])].slice(-5).reverse();
  const currentItem = scanner.current_item || recentItems[0]?.display_name || "正在准备扫描任务...";
  const phaseIndex = getPhaseIndex(scanner.status, clampedPercent);

  const phases = [
    { label: "读取目录", icon: FolderTree },
    { label: "抽取摘要", icon: FileSearch },
    { label: "判断用途", icon: Sparkles },
    { label: "结果汇总", icon: Layers3 },
  ];

  return (
    <div className="flex h-full w-full items-center justify-center bg-surface p-4 lg:p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex h-full max-h-[860px] w-full max-w-[1400px] flex-col overflow-hidden rounded-[14px] border border-black/5 bg-white shadow-2xl"
      >
        {/* 顶部状态栏 */}
        <div className="border-b border-black/[0.04] bg-surface-container-low/40 px-6 py-5">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] border",
                meta.tone === "error" ? "border-error/20 bg-error/8 text-error" : "border-primary/15 bg-primary/8 text-primary"
              )}>
                {meta.tone === "error" ? <AlertCircle className="h-6 w-6" /> : <ScanSearch className="h-6 w-6" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider", meta.tone === "error" ? "bg-error/10 text-error" : "bg-primary/10 text-primary")}>
                    {meta.stageLabel}
                  </span>
                  <div className="h-1 w-1 rounded-full bg-black/20" />
                  <span className="text-[12px] font-bold text-ui-muted">{clampedPercent}% 完成</span>
                </div>
                <h2 className="mt-1 text-[20px] font-black tracking-tight text-on-surface">{meta.title}</h2>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-[11px] font-bold uppercase tracking-widest text-ui-muted mb-1">PROCESSED</p>
                <p className="text-[22px] font-black tabular-nums text-on-surface leading-none">{scanner.processed_count || 0} <span className="text-[14px] opacity-30">/ {scanner.total_count || "..."}</span></p>
              </div>
              <div className="h-8 w-px bg-black/5" />
              {onAbort && (
                <button
                  onClick={onAbort}
                  disabled={aborting}
                  className="group flex h-10 items-center gap-2 rounded-[8px] border border-black/10 px-4 text-[12px] font-bold text-on-surface transition-all hover:bg-error hover:text-white hover:border-error disabled:opacity-50"
                >
                  <StopCircle className="h-4 w-4 transition-transform group-hover:scale-110" />
                  {aborting ? "停止中" : "停止扫描"}
                </button>
              )}
            </div>
          </div>

          <div className="relative mt-6 h-1.5 w-full overflow-hidden rounded-full bg-black/5">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${clampedPercent}%` }}
              className={cn("h-full rounded-full transition-all duration-500", meta.tone === "error" ? "bg-error" : "bg-primary")}
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          {/* 左侧：实时流 (75%) */}
          <div className="flex min-w-0 flex-1 flex-col border-r border-black/[0.04] p-6 overflow-hidden">
            {/* 当前处理 (Highlighted) */}
            <div className="relative overflow-hidden rounded-[12px] border border-primary/15 bg-primary/[0.03] p-6 shadow-sm">
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex h-2 w-2 rounded-full bg-primary animate-ping" />
                  <span className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">正在分析当前文件</span>
                </div>
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] bg-white shadow-md ring-1 ring-black/[0.05]">
                    <Search className="h-7 w-7 text-primary animate-pulse" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-[20px] font-black tracking-tight text-on-surface leading-snug">{currentItem}</p>
                    <p className="mt-2 text-[13px] font-medium text-ui-muted italic flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary/60" />
                      {meta.helper}
                    </p>
                  </div>
                </div>
              </div>
              <div className="absolute right-0 top-0 opacity-[0.03] pointer-events-none">
                <Activity className="h-32 w-32 -mr-8 -mt-8" />
              </div>
            </div>

            {/* 历史轨迹列表 */}
            <div className="mt-8 flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between border-b border-black/[0.05] pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <span className="text-[12px] font-black uppercase tracking-widest text-on-surface">实时分析记录</span>
                </div>
                <span className="text-[11px] font-bold text-emerald-500 animate-pulse">● LIVE</span>
              </div>

              <div className="mt-4 flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin">
                {recentItems.length > 0 ? (
                  recentItems.map((item, index) => (
                    <motion.div
                      key={`${item.item_id}-${index}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "rounded-[10px] border p-4 transition-all duration-300",
                        index === 0 ? "border-primary/20 bg-primary/[0.01] shadow-sm transform scale-[1.01]" : "border-black/[0.04] bg-surface-container-low/30"
                      )}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[15px] font-black tracking-tight text-on-surface">{item.display_name}</p>
                            {index === 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-black text-white">NEW</span>}
                          </div>
                          <p className="mt-1 truncate text-[11px] font-bold text-ui-muted/70">{item.source_relpath}</p>
                        </div>
                        {item.suggested_purpose && (
                          <div className="shrink-0 rounded-[6px] bg-primary/10 px-2.5 py-1 text-[11px] font-black text-primary uppercase">
                            {item.suggested_purpose}
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex gap-2 rounded-[6px] bg-black/[0.02] p-2.5">
                        <Clock3 className="h-3.5 w-3.5 shrink-0 text-ui-muted mt-0.5" />
                        <p className="text-[12px] leading-relaxed text-ui-muted font-medium">{getItemSummary(item)}</p>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="flex h-full items-center justify-center py-20">
                    <div className="text-center">
                      <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary/30" />
                      <p className="mt-4 text-[13px] font-black text-on-surface/40 uppercase tracking-widest">正在准备分析流程...</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右侧：步进状态 (25%) */}
          <aside className="w-full shrink-0 flex-col bg-surface-container-low/30 p-6 xl:w-[320px]">
            <div className="flex items-center gap-2 mb-6">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="text-[12px] font-black uppercase tracking-widest text-on-surface/60">扫描轨迹</span>
            </div>

            <div className="space-y-6">
              {phases.map((phase, index) => {
                const Icon = phase.icon;
                const isActive = index === phaseIndex;
                const isDone = scanner.status !== "failed" && index < phaseIndex;
                return (
                  <div key={phase.label} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
                        isDone ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" :
                          isActive ? "border-primary/20 bg-primary text-white shadow-lg shadow-primary/20" :
                            "border-black/5 bg-black/5 text-on-surface/30"
                      )}>
                        {isDone ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                      </div>
                      {index < phases.length - 1 && <div className="mt-2 h-8 w-px bg-black/5" />}
                    </div>
                    <div className="pt-0.5">
                      <p className={cn("text-[14px] font-black", isActive ? "text-primary" : isDone ? "text-on-surface/70" : "text-on-surface/30")}>
                        {phase.label}
                      </p>
                      <p className="mt-0.5 text-[11px] font-bold text-ui-muted opacity-60">
                        {isActive ? "正在执行中..." : isDone ? "任务已完成" : "等待处理"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-12 space-y-3">
              <div className="rounded-[10px] bg-primary/5 p-4 border border-primary/10">
                <div className="flex items-center gap-2 text-primary">
                  <ImageIcon className="h-4 w-4" />
                  <span className="text-[12px] font-bold">深度学习模型已就绪</span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ui-muted font-bold">
                  系统会自动识别文档、图片、代码及零散文件，并根据上下文建立整理索引。
                </p>
              </div>
              <div className="p-4 border border-black/5 rounded-[10px]">
                <p className="text-[11px] leading-relaxed text-ui-muted italic">
                  此过程完全在本地（或私有 API）运行，我们将保护您的隐私。
                </p>
              </div>
            </div>
          </aside>
        </div>
      </motion.div>
    </div>
  );
}
