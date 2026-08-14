"use client";

import React from "react";
import { motion } from "motion/react";
import { ArrowRight, FolderCheck, FolderOpen, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExecutionProgressViewProps {
  mode: "executing" | "rolling_back";
  title?: string;
  description?: string;
  itemCount?: number;
}

export function ExecutionProgressView({
  mode,
  title,
  description,
  itemCount,
}: ExecutionProgressViewProps) {
  const isRollingBack = mode === "rolling_back";

  const defaultTitle = isRollingBack ? "正在还原文件至原位..." : "正在执行文件整理...";
  const defaultDescription = isRollingBack
    ? "正在按记录恢复文件原始路径并清理空目录，请不要关闭窗口。"
    : "正在将文件移动至目标分类目录，完成后将自动打开整理结果。";

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-6 bg-surface">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative flex w-full max-w-[480px] flex-col items-center rounded-2xl border border-on-surface/8 bg-surface-container-lowest p-8 shadow-sm text-center"
      >
        {/* 背景微光 */}
        <div className="absolute inset-0 -z-10 rounded-2xl bg-gradient-to-b from-primary/[0.03] to-transparent" />

        {/* 动态文件流向图标组 */}
        <div className="relative mb-6 flex items-center justify-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-on-surface/8 bg-on-surface/[0.02] text-ui-muted/70">
            <FolderOpen className="h-7 w-7" />
          </div>

          <div className="flex flex-col items-center">
            <motion.div
              animate={isRollingBack ? { rotate: -360 } : { x: [0, 6, 0] }}
              transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border shadow-sm",
                isRollingBack
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-primary/30 bg-primary/10 text-primary"
              )}
            >
              {isRollingBack ? <RotateCcw className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
            </motion.div>
          </div>

          <div className={cn(
            "flex h-14 w-14 items-center justify-center rounded-2xl border shadow-sm",
            isRollingBack
              ? "border-warning/20 bg-warning/5 text-warning"
              : "border-success/20 bg-success/5 text-success-dim"
          )}>
            <FolderCheck className="h-7 w-7" />
          </div>
        </div>

        {/* 状态徽标 */}
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-3 py-1 text-[11px] font-bold text-primary">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{isRollingBack ? "正在撤销整理变动" : "正在安全写入目标目录"}</span>
        </div>

        {/* 标题与描述 */}
        <h3 className="text-[18px] font-black tracking-tight text-on-surface">
          {title || defaultTitle}
        </h3>
        <p className="mt-2 text-[13px] font-medium leading-relaxed text-ui-muted/75 max-w-[380px]">
          {description || defaultDescription}
        </p>

        {/* 底部保障条 */}
        <div className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-on-surface/6 bg-on-surface/[0.02] py-2.5 px-4 text-[11px] font-bold text-ui-muted/80">
          <ShieldCheck className="h-4 w-4 text-success-dim shrink-0" />
          <span>
            {isRollingBack
              ? "还原过程严格校验源路径完整性"
              : "操作完成支持随时一键安全还原"}
          </span>
        </div>
      </motion.div>
    </div>
  );
}
