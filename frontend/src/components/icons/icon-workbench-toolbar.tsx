"use client";

import React from "react";
import { ChevronRight, FolderPlus, LayoutGrid, Settings2, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface IconWorkbenchToolbarProps {
  targetCount: number;
  latestTargetPath?: string | null;
  onAddTargets: () => void;
  onClearTargets: () => void;
  onOpenStylePanel: () => void;
  onOpenTemplateDrawer: () => void;
  selectedTemplateName?: string;
}

export function IconWorkbenchToolbar({
  targetCount,
  latestTargetPath,
  onAddTargets,
  onClearTargets,
  onOpenStylePanel,
  onOpenTemplateDrawer,
  selectedTemplateName = "请先选择风格",
}: IconWorkbenchToolbarProps) {
  const targetSummary = targetCount > 0 ? `已选择 ${targetCount} 个目标文件夹` : "请先选择要美化图标的文件夹";
  const targetDetail = targetCount > 0
    ? latestTargetPath || "你可以继续追加新的目标文件夹。"
    : "支持一次选择多个目标文件夹，并在工作台里继续追加。";

  return (
    <div className="glass-surface flex min-h-[64px] shrink-0 items-center justify-between border-b border-on-surface/6 px-6 py-2.5">
      <div className="flex items-center gap-3 overflow-hidden">
        <Button
          variant="secondary"
          size="sm"
          onClick={onAddTargets}
          className="shrink-0 bg-primary/8 text-primary hover:bg-primary/12"
        >
          <FolderPlus className="h-4 w-4" />
          {targetCount > 0 ? "添加目标文件夹" : "选择目标文件夹"}
        </Button>

        {targetCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearTargets}
            className="shrink-0 px-3 text-error hover:bg-error/8 hover:text-error"
            title="清空所有目标"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}

        <div className="flex min-w-0 items-center gap-2 overflow-hidden text-[13px] font-medium text-ui-muted">
          <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold tracking-tight text-on-surface" title={targetSummary}>
              {targetSummary}
            </p>
            <p className="truncate text-[11px] opacity-70" title={targetDetail}>
              {targetDetail}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenStylePanel}
          className="group flex items-center gap-2 rounded-[8px] border border-on-surface/7 bg-surface-container-lowest px-3.5 py-2 transition-all hover:border-primary/18 hover:bg-white hover:shadow-[0_8px_18px_rgba(0,0,0,0.05)] active:scale-95"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="flex flex-col items-start pr-1 text-left">
            <span className="text-[10px] font-bold text-ui-muted opacity-80">当前风格</span>
            <span className="max-w-[140px] truncate text-[13px] font-bold tracking-tight text-on-surface">
              {selectedTemplateName}
            </span>
          </div>
        </button>

        <div className="mx-1 h-7 w-px bg-on-surface/6" />

        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenTemplateDrawer}
          className="h-10 w-10 hover:bg-on-surface/4"
          title="管理模板"
        >
          <Settings2 className="h-5 w-5 text-ui-muted" />
        </Button>
      </div>
    </div>
  );
}
