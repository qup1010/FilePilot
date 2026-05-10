"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModelConfigBannerProps {
  title?: string;
  message?: string;
  actionLabel?: string;
  href?: string;
  className?: string;
}

export function ModelConfigBanner({
  title = "AI 文本模型尚未配置",
  message = "未配置文本模型时，系统无法稳定完成用途分析和整理规划。建议先前往“设置 > 文本模型”完成配置。",
  actionLabel = "去配置文本模型",
  href = "/settings?tab=text",
  className,
}: ModelConfigBannerProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-between gap-4 rounded-[8px] border border-warning/18 bg-warning-container/18 px-5 py-4 sm:flex-row sm:items-center",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-warning/12 text-warning">
          <AlertTriangle className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-[14px] font-black tracking-tight text-on-surface">{title}</p>
          <p className="mt-1 text-[12px] font-medium leading-6 text-ui-muted">{message}</p>
        </div>
      </div>
      <Link
        href={href}
        className="shrink-0 rounded-[6px] border border-warning/15 bg-surface px-4 py-2 text-[12px] font-black text-on-surface transition-colors hover:border-warning/30 hover:text-warning"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
