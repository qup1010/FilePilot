"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  X,
  CircleDashed,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { FolderIconCandidate, IconPreviewVersion } from "@/types/icon-workbench";
import { buildImageSrc, getCurrentVersion, hasReadyVersion, resolvePreviewVersion } from "./icon-workbench-utils";
import { IconWorkbenchVersionThumb } from "./icon-workbench-version-thumb";

interface IconWorkbenchFolderCardProps {
  folder: FolderIconCandidate;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelectVersion: (versionId: string) => void;
  onZoom: (version: IconPreviewVersion) => void;
  onApplyVersion: (version: IconPreviewVersion) => void;
  onRegenerate: () => void;
  onRestore: () => void;
  onRemoveTarget: () => void;
  onRemoveBg: (version: IconPreviewVersion) => void;
  onDeleteVersion: (versionId: string) => void;
  processingBgVersionIds?: Set<string>;
  baseUrl: string;
  apiToken: string;
  isApplyingId?: string | null;
  desktopReady: boolean;
  hasSelectedStyle: boolean;
  generateBlockedReason?: string | null;
  isProcessing?: boolean;
  isActiveProcessing?: boolean;
  generateStage?: "analyzing" | "applying_template" | "generating" | null;
}

export function IconWorkbenchFolderCard({
  folder,
  isExpanded,
  onToggleExpand,
  onSelectVersion,
  onZoom,
  onApplyVersion,
  onRegenerate,
  onRestore,
  onRemoveTarget,
  onRemoveBg,
  onDeleteVersion,
  processingBgVersionIds,
  baseUrl,
  apiToken,
  isApplyingId,
  desktopReady,
  hasSelectedStyle,
  generateBlockedReason,
  isProcessing,
  isActiveProcessing,
  generateStage,
}: IconWorkbenchFolderCardProps) {
  const currentVersion = useMemo(() => getCurrentVersion(folder), [folder]);
  const currentPreview = useMemo(() => resolvePreviewVersion(folder), [folder]);
  const hasVersions = folder.versions.length > 0;
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    setPreviewLoaded(false);
    setPreviewFailed(false);
  }, [currentPreview?.version_id]);

  const status = useMemo(() => {
    if (isActiveProcessing) {
      let label = "正在处理";
      if (generateStage === "analyzing") label = "分析目录结构";
      else if (generateStage === "applying_template") label = "套用风格预设";
      else if (generateStage === "generating") label = "正在绘制图标";
      return { label, color: "text-primary", icon: LoaderCircle, animate: true };
    }
    if (currentVersion?.status === "error") return { label: "错误", color: "text-error", icon: AlertCircle };
    if (currentVersion?.status === "ready") return { label: "已就绪", color: "text-primary", icon: CheckCircle2 };
    if (folder.last_error) return { label: "存在问题", color: "text-error", icon: AlertCircle };
    if (hasReadyVersion(folder)) return { label: "有可用预览", color: "text-primary/70", icon: CheckCircle2 };
    if (folder.analysis_status === "ready") return { label: "已分析", color: "text-primary/50", icon: CheckCircle2 };
    return { label: "等待处理", color: "text-ui-muted", icon: CircleDashed };
  }, [currentVersion, folder, isActiveProcessing]);

  const StatusIcon = status.icon;

  return (
    <div className={cn(
      "group flex flex-col overflow-hidden border transition-all duration-200 rounded-xl shadow-sm",
      isExpanded ? "border-primary/25 bg-surface ring-1 ring-primary/10" : "border-on-surface/8 bg-surface-container-lowest hover:border-on-surface/16 hover:bg-surface"
    )}>
      <div className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5" onClick={onToggleExpand}>
        {/* Micro-Thumbnail */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container-low border border-on-surface/8">
          {isActiveProcessing && generateStage === "generating" ? (
            <div className="relative flex h-full w-full items-center justify-center bg-primary/[0.04] animate-pulse">
              <Sparkles className="h-4 w-4 text-primary/60 animate-spin" style={{ animationDuration: "3s" }} />
            </div>
          ) : currentPreview ? (
            <div className="relative h-full w-full">
              {!previewLoaded && !previewFailed && (
                <div className="absolute inset-0 flex items-center justify-center bg-surface-container-low">
                  <LoaderCircle className="h-3 w-3 animate-spin text-primary/30" />
                </div>
              )}
              {!previewFailed && (
                <img
                  src={buildImageSrc(currentPreview, baseUrl, apiToken)}
                  alt="p"
                  onLoad={() => setPreviewLoaded(true)}
                  onError={() => setPreviewFailed(true)}
                  className={cn("h-full w-full object-cover", previewLoaded ? "opacity-100" : "opacity-0")}
                />
              )}
            </div>
          ) : (
            <FolderOpen className="h-3.5 w-3.5 text-primary/30" />
          )}
        </div>

        {/* Info Area */}
        <div className="min-w-0 flex-1 leading-none">
          <div className="flex items-center gap-2">
             <h3 className="truncate text-[13px] font-black tracking-tight text-on-surface/90">{folder.folder_name}</h3>
             {folder.applied_version_id && <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-black uppercase text-primary">已应用</span>}
          </div>
          <p className="truncate text-[11px] font-medium text-ui-muted/50 mt-1 uppercase tracking-tight font-mono">{folder.folder_path}</p>
        </div>

        {/* Compact Status */}
        <div className={cn("hidden items-center gap-2 px-1 sm:flex", status.color)}>
           <span className="text-[11px] font-black uppercase tracking-widest opacity-60">{status.label}</span>
           <StatusIcon className={cn("h-3.5 w-3.5", status.animate && "animate-spin")} />
        </div>

        {/* Quick Actions */}
        <div className={cn("flex items-center gap-1", !isExpanded && "opacity-0 group-hover:opacity-100 transition-opacity")}>
          {!isExpanded && currentVersion?.status === "ready" && (
            <button onClick={(e) => { e.stopPropagation(); onApplyVersion(currentVersion); }} disabled={isProcessing || !desktopReady} className="h-6 items-center rounded-md bg-primary/10 px-2.5 text-[11px] font-black uppercase text-primary hover:bg-primary/20 active:scale-95 disabled:opacity-30 hidden lg:flex transition-all">应用图标</button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onRemoveTarget(); }} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-error/10 text-ui-muted/50 hover:text-error active:scale-90 transition-all"><X className="h-3.5 w-3.5" /></button>
          <div className={cn("h-7 w-7 flex items-center justify-center rounded-md transition-transform text-ui-muted/40", isExpanded && "rotate-180 text-primary")}><ChevronDown className="h-3.5 w-3.5" /></div>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="border-t border-on-surface/6 bg-on-surface/[0.015] overflow-hidden">
            <div className="p-3.5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                   <span className="text-[11px] font-black uppercase tracking-widest text-ui-muted/60">版本历史</span>
                   <span className="rounded-full bg-on-surface/5 px-2 py-0.5 text-[11px] font-bold text-ui-muted/70">{folder.versions.length}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={(e) => { e.stopPropagation(); onRegenerate(); }} disabled={isProcessing || !hasSelectedStyle || !!generateBlockedReason} className="h-6.5 items-center rounded-md bg-primary px-3 text-[11px] font-black uppercase text-white hover:bg-primary-dim active:scale-95 disabled:opacity-30 flex gap-1.5 transition-all shadow-sm"><RefreshCw className="h-3 w-3" /> 生成预览</button>
                  <button disabled={isProcessing || !desktopReady} onClick={(e) => { e.stopPropagation(); onRestore(); }} className="h-6.5 items-center rounded-md border border-on-surface/10 bg-surface px-3 text-[11px] font-bold uppercase text-on-surface hover:bg-on-surface/5 active:scale-95 disabled:opacity-30 transition-all">还原默认图标</button>
                </div>
              </div>

              {hasVersions ? (
                <div
                  data-testid={`version-list-${folder.folder_id}`}
                  className="flex flex-wrap items-start gap-2"
                >
                  {folder.versions.map((version) => (
                    <IconWorkbenchVersionThumb key={version.version_id} version={version} isSelected={version.version_id === folder.current_version_id} isApplied={version.version_id === folder.applied_version_id} baseUrl={baseUrl} apiToken={apiToken} onSelect={() => onSelectVersion(version.version_id)} onZoom={() => onZoom(version)} onApply={() => onApplyVersion(version)} onRemoveBg={() => onRemoveBg(version)} onDelete={() => onDeleteVersion(version.version_id)} isApplying={isApplyingId === version.version_id} isRemovingBg={processingBgVersionIds?.has(`${folder.folder_id}-${version.version_id}`)} isProcessing={isProcessing} />
                  ))}
                </div>
              ) : (
                <div className="flex h-20 items-center justify-center rounded border border-dashed border-on-surface/10 text-[11px] font-bold text-ui-muted/40 uppercase tracking-widest">尚未生成图标预览</div>
              )}

              {folder.analysis && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-on-surface/5">
                  <div className="flex items-center gap-2 rounded bg-on-surface/5 px-2 py-1">
                    <span className="text-[11px] font-black uppercase tracking-widest text-ui-muted/50">识别主体</span>
                    <span className="text-[11px] font-bold text-on-surface/70">{folder.analysis.visual_subject}</span>
                  </div>
                  <div className="flex items-center gap-2 rounded bg-on-surface/5 px-2 py-1">
                    <span className="text-[11px] font-black uppercase tracking-widest text-ui-muted/50">分类建议</span>
                    <span className="text-[11px] font-bold text-on-surface/70">{folder.analysis.category}</span>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
