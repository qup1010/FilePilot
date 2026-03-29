"use client";

import React, { useMemo, useState } from "react";
import { Palette, Search } from "lucide-react";

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
  isProcessing?: boolean;
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
  isProcessing,
}: IconWorkbenchFolderListProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="glass-surface flex flex-col gap-2 border-b border-on-surface/6 px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[16px] font-black tracking-tight text-on-surface">目标文件夹</p>
          </div>
          <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-bold text-ui-muted">
            {folders.length} 个目标
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
        {!hasSelectedStyle && folders.length > 0 && (
          <div className="ui-panel mb-6 flex animate-in fade-in slide-in-from-top-2 duration-500 flex-col items-center gap-4 p-8 text-center bg-white/40 border-dashed">
            <div className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-primary/10 text-primary shadow-sm">
              <Palette className="h-7 w-7" />
            </div>
            <div className="max-w-[320px] space-y-2">
              <p className="text-[17px] font-black tracking-tight text-on-surface">选择一个图标风格</p>
              <p className="text-[13px] leading-relaxed text-ui-muted">
                你已经选择了目标文件夹，现在需要点击顶部的<b>“选择风格”</b>或下方的风格面板，AI 才能为你生成图标。
              </p>
            </div>
          </div>
        )}

        {folders.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center rounded-[8px] border border-dashed border-on-surface/10 bg-surface-container-lowest/70">
            <p className="text-[13px] text-ui-muted">{folders.length === 0 ? "当前还没有目标文件夹" : "没有找到匹配的目标文件夹"}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pb-24">
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
                isProcessing={isProcessing}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
