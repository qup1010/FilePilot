"use client";
import { FolderDown, LoaderCircle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BackgroundRemovalBatchProgress } from "@/types/icon-workbench";
import type { IconGenerationBlockedReason } from "@/types/icon-workbench";

const BLOCKED_REASON_KEYS: Record<IconGenerationBlockedReason, string> = {
  no_targets: "iconWorkbench.blocked.no_targets",
  no_selected_style: "iconWorkbench.blocked.no_selected_style",
  text_model_unconfigured: "iconWorkbench.blocked.text_model_unconfigured",
  image_model_unconfigured: "iconWorkbench.blocked.image_model_unconfigured",
  busy: "iconWorkbench.blocked.busy",
};

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
  removeBgBatchProgress?: BackgroundRemovalBatchProgress | null;
  selectedTemplateName?: string | null;
  generateBlockedReason?: IconGenerationBlockedReason | string | null;
  generateProgressHint?: string | null;
}

function blockedReasonCopy(reason: string, t: (key: string) => string): string {
  const key = BLOCKED_REASON_KEYS[reason as IconGenerationBlockedReason];
  return key ? t(key) : reason;
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
  removeBgBatchProgress,
  selectedTemplateName,
  generateBlockedReason,
  generateProgressHint,
}: IconWorkbenchFooterBarProps) {
  const { t, i18n } = useTranslation("common");
  if (targetCount <= 0) return null;

  const isBusy = isGenerating || isApplying || isRemovingBgBatch;
  const removingBgProgressLabel =
    removeBgBatchProgress && removeBgBatchProgress.activeFolderNames.length > 0
      ? t("iconWorkbench.footer.backgroundProgress", {
          folders: removeBgBatchProgress.activeFolderNames
            .map((name) => i18n.resolvedLanguage?.startsWith("zh") ? `「${name}」` : `“${name}”`)
            .join(i18n.resolvedLanguage?.startsWith("zh") ? "、" : ", "),
          completed: removeBgBatchProgress.completed,
          total: removeBgBatchProgress.total,
        })
      : t("iconWorkbench.footer.backgroundBatchRunning");

  return (
    <div className="border-t border-on-surface/8 bg-surface-container-lowest/80 backdrop-blur-md px-5 h-[52px] flex items-center shrink-0">
      <div className="flex w-full items-center justify-between gap-6 max-w-[1400px] mx-auto">
        
        {/* 指示区 - 极窄扁平化 */}
        <div className="flex items-center gap-4 shrink-0">
           <div className={cn(
             "h-7 w-7 rounded flex items-center justify-center transition-colors",
             isBusy ? "bg-primary/10 text-primary" : "bg-on-surface/5 text-on-surface/30"
           )}>
             {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FolderDown className="h-3.5 w-3.5" />}
           </div>
           <div className="flex items-center gap-2">
              <span className="text-[12px] font-black text-on-surface/80">{t("iconWorkbench.counts.folder", { count: targetCount })}</span>
              <div className="h-3 w-[1px] bg-on-surface/10 mx-1" />
              <span className="text-[11px] font-black uppercase tracking-widest text-ui-muted opacity-40 truncate max-w-[200px]">
                {selectedTemplateName || t("iconWorkbench.footer.waitingForStyle")}
              </span>
           </div>
        </div>

        {/* 信息反馈 - 融入背景 */}
        <div className="flex-1 hidden md:block">
           <p className={cn(
              "text-[11px] font-bold tracking-tight truncate px-4",
              isBusy ? "text-primary/70 animate-pulse" : "text-ui-muted/30"
           )}>
             {isGenerating ? (generateProgressHint || t("iconWorkbench.footer.analyzing")) :
              isRemovingBgBatch ? removingBgProgressLabel :
              isApplying ? t("iconWorkbench.footer.applying") :
              generateBlockedReason ? blockedReasonCopy(generateBlockedReason, t) : t("iconWorkbench.footer.idleHint")}
           </p>
        </div>

        {/* 组合操作区 - 高密度按钮组 */}
        <div className="flex items-center gap-2">
           <div className="flex items-center gap-1 rounded bg-on-surface/5 p-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveBgBatch(); }}
                disabled={!canRemoveBgBatch || isBusy}
                className="h-7 rounded px-3 text-[11px] font-black uppercase text-on-surface/60 hover:bg-on-surface/10 disabled:opacity-20 transition-all"
              >
                {t("iconWorkbench.footer.removeBackgroundBatch")}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onApplyBatch(); }}
                disabled={!canApplyBatch || isBusy}
                className="h-7 rounded px-3 text-[11px] font-black uppercase text-on-surface/60 hover:bg-on-surface/10 disabled:opacity-20 transition-all"
              >
                {t("iconWorkbench.footer.applyAll")}
              </button>
           </div>

           <Button
             onClick={(e) => { e.stopPropagation(); onGenerate(); }}
             disabled={!!generateBlockedReason || isBusy}
             className="h-8 rounded border border-primary/25 bg-primary px-5 text-[11px] font-black uppercase tracking-widest text-white hover:bg-primary-dim active:scale-95 transition-all"
           >
             {isGenerating ? <LoaderCircle className="h-3 w-3 animate-spin mr-2" /> : <Sparkles className="h-3 w-3 mr-2" />}
             {isGenerating ? t("iconWorkbench.footer.generating") : t("iconWorkbench.footer.generatePreview")}
           </Button>
        </div>

      </div>
    </div>
  );
}
