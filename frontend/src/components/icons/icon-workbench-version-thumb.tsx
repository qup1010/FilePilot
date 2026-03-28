"use client";

import React from "react";
import { Check, ZoomIn, LoaderCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IconPreviewVersion } from "@/types/icon-workbench";
import { buildImageSrc } from "./icon-workbench-utils";

interface IconWorkbenchVersionThumbProps {
  version: IconPreviewVersion;
  isSelected: boolean;
  onSelect: () => void;
  onZoom: () => void;
  onApply: () => void;
  onRemoveBg: () => void;
  onDelete: () => void;
  baseUrl: string;
  apiToken: string;
  isApplying?: boolean;
  isRemovingBg?: boolean;
  isProcessing?: boolean;
}

/**
 * 版本缩略图卡片
 * 显示小预览图，下方固定 4 个明确的操作按键 (放大、抠图、应用、删除)
 */
export function IconWorkbenchVersionThumb({
  version,
  isSelected,
  onSelect,
  onZoom,
  onApply,
  onRemoveBg,
  onDelete,
  baseUrl,
  apiToken,
  isApplying = false,
  isRemovingBg = false,
  isProcessing = false,
}: IconWorkbenchVersionThumbProps) {
  const isReady = version.status === "ready";
  const isGenerating = version.status === "generating";
  
  // 给图片路径加上时间戳参数刷新缓存，假设每次抠图后前端都会改变这个URL或添加时间戳
  const imgSrc = isReady ? buildImageSrc(version, baseUrl, apiToken) : "";

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative flex w-[140px] shrink-0 cursor-pointer flex-col gap-2 rounded-xl border p-2.5 transition-all active:scale-95",
        isSelected
          ? "border-primary/20 bg-primary/8 shadow-[0_8px_20px_rgba(36,48,42,0.06)]"
          : "border-on-surface/8 bg-surface-container-low hover:border-primary/14",
      )}
    >
      {/* 图片预览 */}
      <div className="relative aspect-square overflow-hidden rounded-lg border border-on-surface/4 bg-white">
        {isReady ? (
          <img
            src={imgSrc}
            alt={`v${version.version_number}`}
            className="h-full w-full object-cover relative z-10"
          />
        ) : isGenerating ? (
          <div className="flex h-full w-full items-center justify-center">
            <LoaderCircle className="h-6 w-6 animate-spin text-primary/40" />
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-error/60">
            <AlertCircle className="h-6 w-6" />
            <span className="text-[10px] font-medium">生成失败</span>
          </div>
        )}

        {/* 选中标记 */}
        {isSelected && isReady && (
          <div className="absolute right-1 text-[11px] font-semibold text-primary/80 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 shadow-sm z-20">
            <Check className="h-3.5 w-3.5" />
          </div>
        )}
      </div>

      {/* 信息底部与操作按键区 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[14px] font-bold text-on-surface">v{version.version_number}</span>
            {isSelected && (
              <span className="truncate text-[10px] items-center flex font-semibold text-primary/70">
                当前有效
              </span>
            )}
          </div>
        </div>

        {/* 四格操作面板 */}
        {isReady && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); onZoom(); }}
              className="flex h-[26px] items-center justify-center gap-1 rounded-md bg-on-surface/4 text-[11px] font-semibold text-on-surface/80 hover:bg-on-surface/8 hover:text-on-surface active:scale-95"
              title="查看大图"
            >
              <ZoomIn className="h-3 w-3" />
              查看
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onRemoveBg(); }}
              disabled={isRemovingBg || isProcessing}
              className="flex h-[26px] items-center justify-center gap-1 rounded-md bg-on-surface/4 text-[11px] font-semibold text-on-surface/80 hover:bg-primary/10 hover:text-primary active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
              title="移除背景"
            >
              {isRemovingBg ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <span className="text-[14px] leading-none mb-0.5">✂</span>}
              抠图
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onApply(); }}
              disabled={isApplying || isRemovingBg || isProcessing}
              className="flex h-[26px] items-center justify-center gap-1 rounded-md bg-primary/10 text-[11px] font-semibold text-primary hover:bg-primary/20 hover:shadow-sm active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
              title="应用图标"
            >
              {isApplying ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              应用
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              disabled={isApplying || isRemovingBg || isProcessing}
              className="flex h-[26px] items-center justify-center gap-1 rounded-md bg-error/5 text-[11px] font-semibold text-error/80 hover:bg-error/15 hover:text-error active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
              title="移除废弃"
            >
              <span className="text-[12px] font-bold">×</span>
              删除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
