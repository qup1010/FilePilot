"use client";
import { FolderPlus, History, Settings2, Sparkles, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface IconWorkbenchToolbarProps {
  targetCount: number;
  latestTargetPath?: string | null;
  onAddTargets: () => void;
  onClearTargets: () => void;
  onOpenHistory: () => void;
  onOpenStylePanel: () => void;
  onOpenTemplateDrawer: () => void;
  selectedTemplateName?: string;
}

export function IconWorkbenchToolbar({
  targetCount,
  latestTargetPath,
  onAddTargets,
  onClearTargets,
  onOpenHistory,
  onOpenStylePanel,
  onOpenTemplateDrawer,
  selectedTemplateName = "请选择风格模板",
}: IconWorkbenchToolbarProps) {
  const isNoStyleSelected = !selectedTemplateName || selectedTemplateName === "请选择风格模板" || selectedTemplateName === "请选择风格" || selectedTemplateName === "请先选择风格模板";
  const targetSummary = targetCount > 0 ? `${targetCount} 个文件夹` : "未选择文件夹";
  const _targetDetail = targetCount > 0
    ? latestTargetPath || "继续添加文件夹..."
    : "支持一次性选择并分类多个目标。";

  return (
    <div className="flex min-h-[44px] shrink-0 items-center justify-between border-b border-on-surface/[0.06] bg-surface px-4 transition-all">
      <div className="flex items-center gap-3 overflow-hidden">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onAddTargets}
            className="flex h-7.5 items-center gap-2 rounded-lg border border-primary/10 bg-primary/8 px-3.5 text-[11px] font-black text-primary transition-all hover:bg-primary/15 active:scale-95"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>载入文件夹</span>
          </button>

          <button
            onClick={onOpenHistory}
            className="flex h-7.5 w-7.5 items-center justify-center rounded-lg border border-on-surface/8 bg-on-surface/[0.03] text-ui-muted/50 transition-all hover:bg-on-surface/5 hover:text-primary active:scale-90"
            title="历史工作区"
          >
            <History className="h-3.5 w-3.5" />
          </button>

          {targetCount > 0 && (
            <button
              onClick={onClearTargets}
              className="flex h-7.5 w-7.5 items-center justify-center rounded-lg border border-on-surface/8 bg-on-surface/[0.03] text-ui-muted/40 transition-all hover:bg-error/10 hover:text-error active:scale-90"
              title="清空文件夹列表"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 overflow-hidden">
          <div className="h-3 w-px bg-on-surface/10" />
          <div className="min-w-0">
             <p className="truncate text-[12px] font-bold text-on-surface/60 leading-none" title={targetSummary}>
               {targetSummary}
             </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <button
          onClick={onOpenStylePanel}
          className={cn(
            "group flex items-center gap-3 rounded-lg border px-2.5 py-1 transition-all active:scale-[0.98]",
            isNoStyleSelected
              ? "border-primary/30 bg-primary/[0.04] animate-pulse hover:bg-primary/[0.08] hover:border-primary/45"
              : "border-on-surface/5 bg-on-surface/[0.03] hover:border-primary/20 hover:bg-on-surface/[0.05]"
          )}
        >
          <div className={cn(
            "flex h-6.5 w-6.5 items-center justify-center rounded-md border transition-all",
            isNoStyleSelected
              ? "bg-primary/20 text-primary border-primary/30 ring-1 ring-primary/30"
              : "bg-primary/10 text-primary border-primary/20 ring-1 ring-primary/20"
          )}>
            <Sparkles className="h-3 w-3" />
          </div>
          <div className="flex flex-col items-start text-left">
            <span className="text-[11px] font-black text-ui-muted/40 leading-tight">风格模板</span>
            <span className="max-w-[120px] truncate text-[12px] font-black tracking-tight text-on-surface/80 leading-none">
              {selectedTemplateName}
            </span>
          </div>
        </button>

        <div className="h-4 w-px bg-on-surface/8" />

        <button
          onClick={onOpenTemplateDrawer}
          className="flex h-7.5 w-7.5 items-center justify-center rounded-lg border border-on-surface/8 bg-on-surface/[0.02] text-ui-muted/30 transition-all hover:bg-on-surface/5 hover:text-ui-muted active:scale-90"
          title="管理风格模板"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
