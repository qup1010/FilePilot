"use client";

import React from "react";
import { Edit2, Folder, FolderOpen, Layers, CheckCircle2, Info, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarkdownProse } from "../markdown-prose";
import { cn } from "@/lib/utils";
import type { OrganizeMode, PlanItem } from "@/types/session";
import { 
  AvailableTargetOption, 
  REVIEW_DIRECTORY, 
  itemStatusMeta
} from "./preview-utils";

interface PreviewItemDialogProps {
  editingItemId: string | null;
  setEditingItemId: (id: string | null) => void;
  editingItem: PlanItem | null;
  acceptedReviewItemIds: string[];
  readOnly: boolean;
  availableTargetOptions: AvailableTargetOption[];
  applyItemTarget: (itemId: string, payload: { target_dir?: string; target_slot?: string; move_to_review?: boolean }) => Promise<void>;
  showManualInput: boolean;
  setShowManualInput: (show: boolean | ((prev: boolean) => boolean)) => void;
  manualTarget: string;
  setManualTarget: (target: string) => void;
  manualTargetInvalid: boolean;
  manualTargetTrimmed: string;
  availableDirectories: string[];
  organizeMode: OrganizeMode;
  resolveTargetDirectory: (item: PlanItem) => string;
  resolveTargetLabel: (item: PlanItem) => string;
  resolveTargetMeta: (item: PlanItem) => { directoryLabel: string; fullTargetPath: string; mappingLabel: string } | null;
}

export function PreviewItemDialog({
  editingItemId,
  setEditingItemId,
  editingItem,
  acceptedReviewItemIds,
  readOnly,
  availableTargetOptions,
  applyItemTarget,
  showManualInput,
  setShowManualInput,
  manualTarget,
  setManualTarget,
  manualTargetInvalid,
  manualTargetTrimmed,
  availableDirectories,
  organizeMode,
  resolveTargetDirectory,
  resolveTargetLabel,
  resolveTargetMeta,
}: PreviewItemDialogProps) {
  return (
    <Dialog open={!!editingItemId} onOpenChange={(open) => !open && setEditingItemId(null)}>
      <DialogContent className="max-w-2xl sm:rounded-[16px] p-0 overflow-hidden border-on-surface/10 border">
        <DialogHeader className="border-b border-on-surface/6 bg-surface-container-lowest px-6 py-5">
          <div className="flex items-start justify-between pr-6">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-ui-muted flex items-center gap-2">
                <Edit2 className="w-3.5 h-3.5" />
                独立确认
              </p>
              <DialogTitle className="mt-1 text-[18px] font-bold tracking-tight text-on-surface">
                {editingItem?.display_name || "未知条目"}
              </DialogTitle>
            </div>
            {editingItem ? (
              <span className={cn("rounded-full border px-3 py-1.2 text-[12px] font-bold mt-1 shrink-0", itemStatusMeta(editingItem, acceptedReviewItemIds).tone)}>
                {itemStatusMeta(editingItem, acceptedReviewItemIds).label}
              </span>
            ) : null}
          </div>
        </DialogHeader>

        {editingItem ? (
          <div className="max-h-[65vh] overflow-y-auto w-full flex flex-col bg-surface scrollbar-thin">
            
            {/* ACTION AREA - Moved to top for immediate access */}
            {!readOnly ? (
              <div className="shrink-0 border-b border-on-surface/6 bg-on-surface/[0.015] px-6 py-5">
                <div className="space-y-4">
                  <div className="space-y-2.5">
                    <div className="text-[13px] font-bold text-on-surface flex items-center gap-2">
                      <Layers className="w-4 h-4 text-primary" /> 快速调整归属
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {availableTargetOptions.slice(0, 12).map((option) => (
                        <button
                          key={`${editingItem.item_id}-${option.key}`}
                          type="button"
                          onClick={() => {
                            void applyItemTarget(
                              editingItem.item_id,
                              option.directory === REVIEW_DIRECTORY
                                ? { move_to_review: true }
                                : option.targetSlotId
                                  ? { target_slot: option.targetSlotId }
                                  : { target_dir: option.directory },
                            );
                            setEditingItemId(null);
                          }}
                          className={cn(
                            "rounded-[6px] border px-3 py-1.5 text-[11.5px] font-semibold transition-all active:scale-95",
                            (
                              (option.targetSlotId && editingItem.target_slot_id === option.targetSlotId) ||
                              (!option.targetSlotId && resolveTargetDirectory(editingItem) === option.directory)
                            )
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-on-surface/10 bg-surface text-on-surface hover:border-primary/20 hover:bg-surface-container",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-on-surface/6">
                    <button type="button" onClick={() => setShowManualInput((current) => !current)} className="text-[11.5px] font-bold text-primary flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity">
                      {showManualInput ? "- 收起手动路径输入" : "+ 手动指定其他路径"}
                    </button>
                    {showManualInput ? (
                      <div className="relative">
                        <div className="flex gap-2 min-w-0 items-center">
                          <div className="relative flex-1">
                            <input
                              value={manualTarget}
                              onChange={(event) => setManualTarget(event.target.value)}
                              placeholder="如: 新专题/归档"
                              className="h-9 w-full rounded-[6px] border border-on-surface/15 bg-surface px-3 text-[12px] font-medium text-on-surface outline-none focus:border-primary/50"
                            />
                            {/* 目标路径建议 */}
                            {manualTargetTrimmed && !manualTargetInvalid && availableDirectories.filter(d => d.toLowerCase().includes(manualTargetTrimmed.toLowerCase()) && d !== manualTargetTrimmed && d !== REVIEW_DIRECTORY).length > 0 && (
                              <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-[8px] border border-on-surface/10 bg-surface py-1 scrollbar-thin animate-in fade-in slide-in-from-top-2">
                                <div className="px-3 py-1.5 text-[10px] font-bold text-ui-muted uppercase tracking-wider bg-on-surface/[0.02]">建议目标目录</div>
                                {availableDirectories
                                  .filter(d => d.toLowerCase().includes(manualTargetTrimmed.toLowerCase()) && d !== manualTargetTrimmed && d !== REVIEW_DIRECTORY)
                                  .slice(0, 8)
                                  .map((dir) => (
                                    <button
                                      key={`suggest-${dir}`}
                                      type="button"
                                      onClick={() => setManualTarget(dir)}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-on-surface hover:bg-primary/5 hover:text-primary transition-colors"
                                    >
                                      <Folder className="w-3.5 h-3.5 opacity-40" />
                                      <span className="truncate">{dir}</span>
                                    </button>
                                  ))}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (manualTargetInvalid || !manualTargetTrimmed) {
                                return;
                              }
                              void applyItemTarget(editingItem.item_id, { target_dir: manualTargetTrimmed });
                              setEditingItemId(null);
                            }}
                            disabled={manualTargetInvalid || !manualTargetTrimmed}
                            className="shrink-0 h-9 rounded-[6px] bg-on-surface px-4 text-[12px] font-bold text-surface transition-transform active:scale-95 hover:bg-on-surface/90 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            应用此路径
                          </button>
                        </div>
                        <p className="mt-1.5 text-[10.5px] text-ui-muted px-0.5">
                          {organizeMode === "incremental"
                            ? "归入已有目录时，只能填写已显式配置的目标目录；拿不准的项目请点“待确认区”。"
                            : "填写的是相对“新目录生成位置”的路径（不支持绝对路径或待确认区路径）。待确认区只作为暂存落点，不会自动归入目标目录。"}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {/* READONLY DETAILS AREA - Flattened no-card layout */}
            <div className="p-6">
              <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
                
                {/* Left Column: Source Info */}
                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ui-muted opacity-80 mb-1.5 flex items-center gap-1.5">
                      <FolderOpen className="w-3.5 h-3.5" /> 原始条目
                    </div>
                    <div className="break-all text-[13px] font-bold text-on-surface leading-snug">{editingItem.display_name}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-ui-muted opacity-60 mb-1">来源路径</div>
                    <div className="break-all font-mono text-[11px] text-on-surface-variant leading-relaxed">{editingItem.source_relpath}</div>
                  </div>
                </div>

                {/* Right Column: Target Info */}
                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-primary/80 mb-1.5 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 预期归属
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="break-all text-[14px] font-bold text-primary">{resolveTargetMeta(editingItem)?.directoryLabel}</div>
                      <span className="shrink-0 rounded-full border border-on-surface/10 bg-surface px-2 py-0.5 text-[10px] font-bold text-ui-muted">
                        {resolveTargetMeta(editingItem)?.mappingLabel}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-ui-muted opacity-60 mb-1">完整目标路径</div>
                    <div className="break-all font-mono text-[11px] text-on-surface-variant leading-relaxed">{resolveTargetMeta(editingItem)?.fullTargetPath}</div>
                  </div>
                </div>
              </div>

              <div className="mt-8 border-t border-on-surface/6 pt-8 grid gap-x-12 gap-y-8 sm:grid-cols-2">
                {/* Left Column: Reason */}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ui-muted opacity-80 mb-3 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5" /> 归类原因
                  </div>
                  <div className="text-[12.5px] leading-[1.6] text-on-surface/90 text-justify [&>div>p]:mb-2 [&>div>p:last-child]:mb-0">
                    {editingItem.reason || editingItem.suggested_purpose ? (
                      <MarkdownProse content={editingItem.reason || editingItem.suggested_purpose!} />
                    ) : (
                      <span className="opacity-50 italic">未提供说明</span>
                    )}
                  </div>
                </div>

                {/* Right Column: Content Summary */}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ui-muted opacity-80 mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> 内容摘要
                    </div>
                    <div className="text-[10px] font-mono tracking-normal opacity-80">
                      置信度: {typeof editingItem.confidence === "number" ? `${Math.round(editingItem.confidence * 100)}%` : "N/A"}
                    </div>
                  </div>
                  <div className="text-[12.5px] leading-[1.6] text-on-surface/90 text-justify [&>div>p]:mb-2 [&>div>p:last-child]:mb-0">
                    {editingItem.content_summary ? (
                      <MarkdownProse content={editingItem.content_summary} />
                    ) : (
                      <span className="opacity-50 italic">暂无内容摘要</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
