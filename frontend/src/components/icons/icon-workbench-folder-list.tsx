"use client";

import React, { useMemo } from "react";
import { FolderOpen, FolderPlus, Palette, Plus, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { DropZoneOverlay, getDropZoneSurfaceClassName } from "@/components/ui/drop-zone-feedback";
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
      <div 
        ref={dropZoneRef}
        onDrop={onTargetDrop}
        onDragOver={onTargetDragOver}
        onDragLeave={onTargetDragLeave}
        className={getDropZoneSurfaceClassName({
          isActive: isTargetDropActive,
          isDraggingGlobal,
          idleClassName: "border-transparent bg-transparent",
          activeClassName: "border-primary/40 bg-primary/[0.04] ring-1 ring-primary/10",
          draggingClassName: "border-primary/25 bg-primary/[0.015]",
          className: "relative flex-1 min-h-0 overflow-y-auto rounded-[12px] px-4 py-3 scrollbar-thin",
        })}
      >
        {isTargetDropActive && (
          <DropZoneOverlay
            icon={FolderPlus}
            title="松手即可追加目标文件夹"
            detail="支持一次拖入多个文件夹"
            className="inset-3 rounded-2xl border-primary/18 bg-primary/[0.025] backdrop-blur-0"
            panelClassName="rounded-2xl border border-primary/15 bg-surface/96 px-8 py-7 shadow-[0_8px_32px_rgba(0,0,0,0.08)]"
            iconWrapClassName="h-14 w-14 rounded-2xl bg-primary/10"
            titleClassName="tracking-[0.18em]"
            detailClassName="text-on-surface-variant/70"
          />
        )}
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
              <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-on-surface/8 bg-surface-container-lowest shadow-sm">
                <FolderOpen className="h-8 w-8 text-on-surface/10" />
                <motion.div 
                  animate={{ y: [0, -3, 0] }}
                  transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                  className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-[0_2px_8px_rgba(var(--primary-rgb),0.08)]"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </motion.div>
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
                className="group/btn flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-primary/25 bg-primary px-6 text-[13px] font-black uppercase tracking-wider text-white transition-all hover:bg-primary-dim active:scale-95 shadow-sm hover:shadow-[0_4px_12px_rgba(var(--primary-rgb),0.15)]"
              >
                <Plus className="h-4 w-4 stroke-[3] transition-transform group-hover/btn:rotate-90 group-hover/btn:scale-110 duration-300" />
                <span>载入目标</span>
              </button>
              
              <div 
                className={getDropZoneSurfaceClassName({
                  isActive: isTargetDropActive,
                  isDraggingGlobal,
                  idleClassName: "border-on-surface/8 bg-on-surface/[0.015] border-dashed text-on-surface/30 hover:bg-on-surface/[0.035] hover:border-on-surface/12",
                  activeClassName: "border-primary/35 bg-primary/[0.06] text-primary",
                  draggingClassName: "border-primary/20 bg-primary/[0.015] text-on-surface/50",
                  className: "flex h-10 w-full items-center justify-center rounded-lg px-3 text-[11px] font-bold truncate select-none transition-all",
                })}
              >
                {isTargetDropActive ? "松手即可追加目标文件夹" : "或将文件夹拖放至此"}
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="flex flex-col gap-1.5 pb-20">
            {/* 紧凑型追加按钮 */}
            <motion.div
              whileTap={{ scale: 0.98 }}
              onClick={onAddTargets}
              className={getDropZoneSurfaceClassName({
                isActive: isTargetDropActive,
                isDraggingGlobal,
                idleClassName: "border-on-surface/5 bg-on-surface/[0.02] hover:border-primary/10 hover:bg-on-surface/[0.04]",
                activeClassName: "border-primary/30 bg-primary/[0.05] ring-1 ring-primary/10",
                draggingClassName: "border-primary/20 bg-primary/[0.015]",
                className: "group/add-more mb-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5",
              })}
            >
              <Plus className="h-3.5 w-3.5 text-on-surface/20 group-hover/add-more:text-primary transition-colors" />
              <span className="text-[11.5px] font-black uppercase tracking-widest text-on-surface/30 group-hover/add-more:text-primary/60 transition-colors">
                追加目标文件夹
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
