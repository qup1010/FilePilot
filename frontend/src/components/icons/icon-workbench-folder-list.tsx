"use client";

import React, { useMemo } from "react";
import { FolderOpen, FolderPlus, Palette, Plus, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FolderIconCandidate, IconPreviewVersion } from "@/types/icon-workbench";
import { IconWorkbenchFolderCard } from "./icon-workbench-folder-card";

interface IconWorkbenchFolderListProps {
  folders: FolderIconCandidate[];
  expandedFolderId: string | null;
  onToggleExpand: (id: string | null) => void;
  onSelectVersion: (folderId: string, versionId: string) => void;
  onZoom: (version: IconPreviewVersion) => void;
  onApplyVersion: (folderId: string, version: IconPreviewVersion) => void;
  onRegenerate: (folderId: string) => void;
  onRestore: (folderId: string) => void;
  onRemoveTarget: (folderId: string) => void;
  onRemoveBg: (folderId: string, version: IconPreviewVersion) => void;
  onDeleteVersion: (folderId: string, versionId: string) => void;
  processingBgVersionIds?: Set<string>;
  baseUrl: string;
  apiToken: string;
  isApplyingId?: string | null;
  activeProcessingId?: string | null;
  desktopReady: boolean;
  hasSelectedStyle: boolean;
  generateBlockedReason?: string | null;
  isProcessing?: boolean;
  processingFolderId?: string | null;
  onAddTargets?: () => void;
  isTargetDropActive?: boolean;
  onTargetDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onTargetDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onTargetDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
  dropZoneRef?: React.RefObject<HTMLDivElement | null>;
  isDraggingGlobal?: boolean;
}

export function IconWorkbenchFolderList({
  folders,
  expandedFolderId,
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
  activeProcessingId,
  desktopReady,
  hasSelectedStyle,
  generateBlockedReason,
  isProcessing,
  processingFolderId,
  onAddTargets,
  isTargetDropActive = false,
  onTargetDrop,
  onTargetDragOver,
  onTargetDragLeave,
  dropZoneRef,
  isDraggingGlobal = false,
}: IconWorkbenchFolderListProps) {
  const hasReadyVersions = useMemo(
    () => folders.some((folder) => folder.versions.some((version) => version.status === "ready")),
    [folders],
  );

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      <div className="flex-1 relative min-h-0 overflow-y-auto px-4 py-3 scrollbar-thin">
        {/* 精简版：风格配置提醒 */}
        {!hasSelectedStyle && folders.length > 0 && !hasReadyVersions && (
          <div className="mb-3 flex animate-in fade-in slide-in-from-top-2 duration-500 items-center gap-3 rounded-lg border border-primary/20 bg-primary/[0.03] px-4 py-2">
            <Palette className="h-3.5 w-3.5 text-primary opacity-60" />
            <p className="text-[11.5px] font-bold text-on-surface/80">请配置图标风格</p>
            <p className="text-[10px] font-medium text-ui-muted opacity-50 flex-1">点击工具栏“选择风格模板”以开始生成预览方案</p>
          </div>
        )}

        {folders.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 px-6 text-center"
          >
            {/* 视觉图形组：更简约的单层风格 */}
            <div className="relative mb-6 flex h-20 w-20 items-center justify-center">
              <div className="relative flex h-20 w-20 items-center justify-center rounded-[22px] border border-on-surface/8 bg-surface-container-lowest shadow-sm">
                <FolderOpen className="h-8 w-8 text-on-surface/10" />
                <div className="absolute -right-0.5 -top-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
              </div>
            </div>

            {/* 文案说明 */}
            <div className="max-w-[320px] mb-8">
              <h2 className="text-[15px] font-black tracking-tight text-on-surface/90 mb-2">待命中的图标工坊</h2>
              <p className="text-[12px] font-medium leading-relaxed text-on-surface/40">
                通过 AI 技术分析文件夹语义，并为其自动匹配、生成或应用精美的定制图标。
              </p>
            </div>

            {/* 操作区域 */}
            <div className="flex flex-col gap-3 w-full max-w-[200px]">
              <button
                onClick={onAddTargets}
                className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-primary/25 bg-primary px-6 text-[13px] font-black uppercase tracking-wider text-white transition-all hover:bg-primary-dim active:scale-95"
              >
                <Plus className="h-4 w-4 stroke-[3]" />
                <span>载入目标</span>
              </button>
              
              <div 
                ref={dropZoneRef}
                onDrop={onTargetDrop}
                onDragOver={onTargetDragOver}
                onDragLeave={onTargetDragLeave}
                className={cn(
                   "flex h-10 w-full items-center justify-center rounded-lg border border-dashed text-[11px] font-bold transition-all",
                   isTargetDropActive 
                     ? "border-primary bg-primary/10 text-primary" 
                     : "border-on-surface/10 bg-on-surface/[0.02] text-on-surface/30 px-3 truncate"
                )}
              >
                {isTargetDropActive ? "释放以载入" : "或将文件夹拖放至此"}
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="flex flex-col gap-1.5 pb-20">
            {/* 紧凑型追加按钮 */}
            <motion.div
              ref={dropZoneRef}
              onDrop={onTargetDrop}
              onDragOver={onTargetDragOver}
              onDragLeave={onTargetDragLeave}
              className={cn(
                "mb-2 flex items-center justify-center gap-2 rounded-lg border border-dashed py-2.5 transition-all group/add-more",
                isTargetDropActive 
                  ? "border-primary bg-primary/5" 
                  : "border-on-surface/5 bg-on-surface/[0.02] hover:border-primary/10 hover:bg-on-surface/[0.04]"
              )}
            >
              <Plus className={cn(
                "h-3 w-3 transition-colors",
                isTargetDropActive ? "text-primary" : "text-on-surface/20 group-hover/add-more:text-primary"
              )} />
              <span className={cn(
                "text-[11px] font-black uppercase tracking-widest transition-colors",
                isTargetDropActive ? "text-primary" : "text-on-surface/30 group-hover/add-more:text-primary/60"
              )}>
                {isTargetDropActive ? "释放以追加" : "追加目标文件夹"}
              </span>
            </motion.div>

            {folders.map((folder) => (
              <IconWorkbenchFolderCard
                key={folder.folder_id}
                folder={folder}
                isExpanded={expandedFolderId === folder.folder_id}
                onToggleExpand={() => onToggleExpand(expandedFolderId === folder.folder_id ? null : folder.folder_id)}
                onSelectVersion={(versionId) => onSelectVersion(folder.folder_id, versionId)}
                onZoom={(version) => onZoom(version)}
                onApplyVersion={(version) => onApplyVersion(folder.folder_id, version)}
                onRegenerate={() => onRegenerate(folder.folder_id)}
                onRestore={() => onRestore(folder.folder_id)}
                onRemoveTarget={() => onRemoveTarget(folder.folder_id)}
                onRemoveBg={(version) => onRemoveBg(folder.folder_id, version)}
                onDeleteVersion={(versionId) => onDeleteVersion(folder.folder_id, versionId)}
                processingBgVersionIds={processingBgVersionIds}
                baseUrl={baseUrl}
                apiToken={apiToken}
                isApplyingId={activeProcessingId === folder.folder_id ? isApplyingId : null}
                desktopReady={desktopReady}
                hasSelectedStyle={hasSelectedStyle}
                generateBlockedReason={generateBlockedReason}
                isProcessing={isProcessing}
                isActiveProcessing={processingFolderId === folder.folder_id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
