"use client";

import React, { useMemo } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FolderIconCandidate, IconPreviewVersion } from "@/types/icon-workbench";
import { buildImageSrc, resolvePreviewVersion } from "./icon-workbench-utils";
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
  isProcessing?: boolean;
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
  isProcessing,
}: IconWorkbenchFolderCardProps) {
  const currentPreview = useMemo(() => resolvePreviewVersion(folder), [folder]);
  const hasVersions = folder.versions.length > 0;
  const generateLabel = hasVersions ? "重新生成" : "生成第一版";

  const status = useMemo(() => {
    if (folder.last_error) return { label: "异常", color: "text-error", icon: AlertCircle };
    if (folder.versions.some((version) => version.status === "ready")) {
      return {
        label: `v${currentPreview?.version_number || 1} 就绪`,
        color: "text-primary",
        icon: CheckCircle2,
      };
    }
    if (folder.analysis_status === "ready") return { label: "分析完成", color: "text-primary/70", icon: CheckCircle2 };
    return { label: "待处理", color: "text-ui-muted", icon: CircleDashed };
  }, [currentPreview?.version_number, folder]);

  const StatusIcon = status.icon;

  return (
    <div
      className={cn(
        "group flex flex-col overflow-hidden rounded-[10px] border transition-all duration-200",
        isExpanded
          ? "border-primary/20 bg-white shadow-[0_12px_32px_rgba(0,0,0,0.08)]"
          : "border-on-surface/8 bg-surface-container-low/40 hover:border-primary/14 hover:bg-white",
      )}
    >
      <div className="flex cursor-pointer items-center gap-3 px-4 py-3" onClick={onToggleExpand}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-on-surface/6 bg-white">
          {currentPreview ? (
            <img src={buildImageSrc(currentPreview, baseUrl, apiToken)} alt="preview" className="h-full w-full object-cover" />
          ) : (
            <FolderOpen className="h-5 w-5 text-primary/30" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-bold tracking-tight text-on-surface">{folder.folder_name}</h3>
          <p className="truncate text-[11px] text-ui-muted">{folder.folder_path}</p>
        </div>

        <div className={cn("hidden items-center gap-1.5 sm:flex", status.color)}>
          <StatusIcon className="h-3.5 w-3.5" />
          <span className="text-[12px] font-semibold">{status.label}</span>
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemoveTarget();
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ui-muted transition-colors hover:bg-error/8 hover:text-error"
          title="移出本次目标"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex h-8 w-8 items-center justify-center rounded-full text-ui-muted transition-colors group-hover:bg-on-surface/4">
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {isExpanded ? (
        <div className="animate-fadeIn border-t border-on-surface/6 bg-surface-container-lowest/30 p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold uppercase tracking-widest text-ui-muted">
                版本历史 ({folder.versions.length})
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(event: React.MouseEvent) => {
                    event.stopPropagation();
                    onRegenerate();
                  }}
                  disabled={isProcessing || !hasSelectedStyle}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  {generateLabel}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isProcessing || !desktopReady}
                  onClick={(event: React.MouseEvent) => {
                    event.stopPropagation();
                    onRestore();
                  }}
                >
                  恢复默认
                </Button>
              </div>
            </div>

            {!hasSelectedStyle ? (
              <p className="text-[12px] leading-6 text-ui-muted">请先选择风格，再为这个目标文件夹生成图标版本。</p>
            ) : null}

            {hasVersions ? (
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                {folder.versions.map((version) => (
                  <IconWorkbenchVersionThumb
                    key={version.version_id}
                    version={version}
                    isSelected={version.version_id === folder.current_version_id}
                    baseUrl={baseUrl}
                    apiToken={apiToken}
                    onSelect={() => onSelectVersion(version.version_id)}
                    onZoom={() => onZoom(version)}
                    onApply={() => onApplyVersion(version)}
                    onRemoveBg={() => onRemoveBg(version)}
                    onDelete={() => onDeleteVersion(version.version_id)}
                    isApplying={isApplyingId === version.version_id}
                    isRemovingBg={processingBgVersionIds?.has(`${folder.folder_id}-${version.version_id}`)}
                    isProcessing={isProcessing}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-[100px] flex-col items-center justify-center rounded-xl border border-dashed border-on-surface/10 bg-white/50">
                <p className="px-4 text-center text-[13px] leading-6 text-ui-muted">
                  {!hasSelectedStyle
                    ? "先选择风格后，才能为这个目标文件夹生成第一版图标。"
                    : "可以直接为这个目标文件夹生成第一版图标。"}
                </p>
              </div>
            )}
          </div>

          {folder.analysis ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-on-surface/6 bg-white p-3 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-widest text-ui-muted">识别主题</span>
                <p className="mt-1 font-semibold text-on-surface">{folder.analysis.visual_subject}</p>
              </div>
              <div className="rounded-xl border border-on-surface/6 bg-white p-3 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-widest text-ui-muted">类别</span>
                <p className="mt-1 font-semibold text-on-surface">{folder.analysis.category}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
