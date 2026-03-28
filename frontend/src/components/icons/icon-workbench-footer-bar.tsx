"use client";

import React from "react";
import { CheckCircle2, FolderDown, Info, LoaderCircle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface IconWorkbenchFooterBarProps {
  targetCount: number;
  isGenerating: boolean;
  isApplying: boolean;
  onGenerate: () => void;
  onApplyBatch: () => void;
  canApplyBatch: boolean;
  onRemoveBgBatch: () => void;
  canRemoveBgBatch: boolean;
  isRemovingBgBatch: boolean;
  selectedTemplateName?: string | null;
  generateBlockedReason?: string | null;
}

export function IconWorkbenchFooterBar({
  targetCount,
  isGenerating,
  isApplying,
  onGenerate,
  onApplyBatch,
  canApplyBatch,
  onRemoveBgBatch,
  canRemoveBgBatch,
  isRemovingBgBatch,
  selectedTemplateName,
  generateBlockedReason,
}: IconWorkbenchFooterBarProps) {
  if (targetCount <= 0) {
    return null;
  }

  return (
    <div className="ui-panel-elevated fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-5 px-5 py-3 animate-slideUp">
      <div className="flex min-w-[220px] items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-primary/10 text-primary">
          <FolderDown className="h-4.5 w-4.5" />
        </div>
        <div className="flex flex-col">
          <span className="text-[15px] font-black tracking-tight text-on-surface">{targetCount} 个目标文件夹</span>
          <span className="text-[11px] text-ui-muted">{selectedTemplateName ? `当前风格：${selectedTemplateName}` : "准备完成，可以开始生成。"}</span>
        </div>
      </div>

      <div className="h-9 w-px bg-on-surface/8" />

      <div className="flex min-w-[380px] flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={(event: React.MouseEvent) => {
              event.stopPropagation();
              onGenerate();
            }}
            disabled={Boolean(generateBlockedReason) || isGenerating || isApplying || isRemovingBgBatch}
            className="h-11 px-5 focus:ring-0"
          >
            {isGenerating ? <LoaderCircle className="h-4.5 w-4.5 animate-spin" /> : <Sparkles className="h-4.5 w-4.5" />}
            {isGenerating ? "正在生成中..." : `开始生成 ${targetCount} 个图标`}
          </Button>

          <Button
            variant="secondary"
            size="lg"
            onClick={(event: React.MouseEvent) => {
              event.stopPropagation();
              onRemoveBgBatch();
            }}
            disabled={!canRemoveBgBatch || isGenerating || isApplying || isRemovingBgBatch}
            className="h-11 border-on-surface/8 bg-surface-container-lowest px-5 text-on-surface hover:bg-white transition-all"
          >
            {isRemovingBgBatch ? <LoaderCircle className="h-4.5 w-4.5 animate-spin" /> : <span className="text-[16px] leading-none mb-0.5">✂</span>}
            {isRemovingBgBatch ? "抠图中..." : "一键抠图"}
          </Button>

          <Button
            variant="secondary"
            size="lg"
            onClick={(event: React.MouseEvent) => {
              event.stopPropagation();
              onApplyBatch();
            }}
            disabled={!canApplyBatch || isGenerating || isApplying || isRemovingBgBatch}
            className="h-11 border-on-surface/8 bg-surface-container-lowest px-5 text-on-surface hover:bg-white transition-all"
          >
            {isApplying ? <LoaderCircle className="h-4.5 w-4.5 animate-spin" /> : <CheckCircle2 className="h-4.5 w-4.5" />}
            {isApplying ? "应用中..." : "一键应用"}
          </Button>
        </div>
        <p className={cn("min-h-[16px] text-[10.5px] font-medium transition-opacity", 
          isGenerating || isRemovingBgBatch || isApplying ? "text-primary opacity-80" : 
          generateBlockedReason ? "text-error/70" : "text-ui-muted"
        )}>
          {isGenerating ? "正在调用模型生成图像，通常需要数秒，请稍候..." :
           isRemovingBgBatch ? "正在自动移除背景并保留画面主体元素..." :
           isApplying ? "正在将透明图标批量覆盖至 Windows 系统文件夹配置..." :
           generateBlockedReason || "生成后会先产出预览版本，确认满意后再一键应用至系统。"}
        </p>
      </div>

      <div className="group relative ml-1">
        <Info className="h-4 w-4 cursor-help text-on-surface/22 transition-colors hover:text-on-surface/50" />
        <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 w-48 -translate-x-1/2 scale-95 rounded-[12px] border border-on-surface/8 bg-surface-container-lowest p-3 text-[11px] font-medium leading-6 text-on-surface opacity-0 shadow-xl transition-all group-hover:scale-100 group-hover:opacity-100">
          图标会先生成预览版本，只有点击应用后才会替换系统显示的文件夹图标。
        </div>
      </div>
    </div>
  );
}
