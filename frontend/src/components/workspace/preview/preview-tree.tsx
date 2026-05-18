"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, Edit2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { PlacementConfig, PlanItem } from "@/types/session";
import { 
  TreeNode, 
  TargetSlotLookup, 
  itemStatusMeta, 
  normalizeEntryKind, 
  isItemChanged, 
  displayDirectoryLabel, 
  fileExtension 
} from "./preview-utils";

interface TreeBranchProps {
  node: TreeNode;
  depth: number;
  expanded: Record<string, boolean>;
  selectedItemId: string | null;
  onToggle: (path: string) => void;
  onSelectItem: (itemId: string | null) => void;
  onEditItem: (itemId: string) => void;
  acceptedReviewItemIds: string[];
  viewMode: "before" | "after";
  targetSlotById: TargetSlotLookup;
  placement: PlacementConfig;
}

export function TreeBranch({
  node,
  depth,
  expanded,
  selectedItemId,
  onToggle,
  onSelectItem,
  onEditItem,
  acceptedReviewItemIds,
  viewMode,
  targetSlotById,
  placement,
}: TreeBranchProps) {
  const [isHovered, setIsHovered] = useState(false);
  
  if (node.kind === "file") {
    if (node.item) {
      const status = itemStatusMeta(node.item, acceptedReviewItemIds);
      const ItemIcon = normalizeEntryKind(node.item.entry_type) === "directory" ? Folder : FileText;
      const active = selectedItemId === node.item.item_id;
      const hasMoved = viewMode === "after" && isItemChanged(node.item, targetSlotById, placement);

      return (
        <div
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="flex flex-col"
        >
          <button
            type="button"
            onClick={() => onSelectItem(active ? null : node.item!.item_id)}
            onDoubleClick={() => onEditItem(node.item!.item_id)}
            className={cn(
              "group relative flex w-full items-center gap-3 py-1.5 pr-2 text-left transition-all border-b border-on-surface/[0.04] last:border-0",
              active ? "bg-primary/[0.06] border-l-2 border-primary" : "hover:bg-on-surface/[0.02]",
            )}
            title="双击编辑条目"
            style={{ paddingLeft: 12 + depth * 16 }}
          >
            {Array.from({ length: depth }).map((_, idx) => (
              <div
                key={idx}
                className="absolute top-0 bottom-0 w-[1px] bg-on-surface/[0.03] group-hover:bg-primary/10 transition-colors pointer-events-none"
                style={{ left: 16 + idx * 16 }}
              />
            ))}
            <ItemIcon className={cn("h-3.5 w-3.5 shrink-0 transition-colors", active ? "text-primary/70" : "text-on-surface-variant/30")} />
            <div className="min-w-0 flex-1 py-0.5">
              <div className="flex items-center gap-2">
                <p className={cn("truncate font-mono text-[12px] font-black tracking-tight transition-colors", active ? "text-primary font-bold" : "text-on-surface/80")}>
                  {node.item.display_name}
                </p>
                {hasMoved && node.item.source_relpath.replace(/\\/g, "/").split('/').slice(0, -1).pop() && (
                   <span
                     className="truncate text-[9px] font-semibold tracking-normal text-ui-muted opacity-20 transition-opacity group-hover:opacity-45 whitespace-nowrap"
                     title={`原本位于源目录下的 ${node.item.source_relpath.replace(/\\/g, "/").split('/').slice(0, -1).pop()} 文件夹中`}
                   >
                      ← {node.item.source_relpath.replace(/\\/g, "/").split('/').slice(0, -1).pop()}
                   </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {node.item.status !== "assigned" && node.item.status !== "skipped" && (
                <span className={cn("rounded-[3px] border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest shrink-0", status.tone)}>
                  {status.label}
                </span>
              )}
              
              <div
                role="button"
                tabIndex={0}
                aria-label={`编辑 ${node.item.display_name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditItem(node.item!.item_id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onEditItem(node.item!.item_id);
                  }
                }}
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-on-surface/10 bg-surface opacity-0 pointer-events-none transition-all hover:bg-on-surface/[0.02] active:scale-90 group-hover:opacity-100 group-hover:pointer-events-auto focus:opacity-100 focus:pointer-events-auto focus:outline-none focus:ring-1 focus:ring-primary/20",
                )}
                title="编辑"
              >
                <Edit2 className="h-3 w-3 text-on-surface-variant/60" />
              </div>
            </div>
          </button>
          
          <AnimatePresence>
            {isHovered && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
                style={{ paddingLeft: 34 + depth * 16 }}
              >
                <div className="space-y-1 pb-1.5 pt-0.5 pr-4 border-b border-on-surface/[0.02]">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-sm bg-primary/10 px-1 text-[8px] font-black tracking-wider text-primary/70">用途判断</span>
                    <p className="truncate text-[10.5px] font-medium text-ui-muted/70 leading-tight italic">
                      {node.item.suggested_purpose || "根据文件名和内容线索预测"}
                    </p>
                  </div>
                  {node.item.content_summary ? (
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded-sm bg-on-surface/[0.04] px-1 text-[8px] font-black tracking-wider text-ui-muted/50">内容摘要</span>
                      <p className="truncate text-[10.5px] font-medium text-ui-muted/55 leading-tight" title={node.item.content_summary}>
                        {node.item.content_summary}
                      </p>
                    </div>
                  ) : null}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

    return (
      <div
        className="group relative flex w-full items-center gap-3 border-b border-on-surface/[0.04] py-2 pr-3 text-left"
        style={{ paddingLeft: 12 + depth * 16 }}
      >
        {Array.from({ length: depth }).map((_, idx) => (
          <div
            key={idx}
            className="absolute top-0 bottom-0 w-[1px] bg-on-surface/[0.03] group-hover:bg-primary/10 transition-colors pointer-events-none"
            style={{ left: 16 + idx * 16 }}
          />
        ))}
        <FileText className="h-3.5 w-3.5 shrink-0 text-on-surface-variant/20" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[12px] font-black tracking-tight text-on-surface/50">{node.sourceEntry?.display_name || node.name}</p>
          <p className="truncate text-[10px] font-bold uppercase tracking-wider text-ui-muted opacity-30">Original Item</p>
        </div>
      </div>
    );
  }

  const isExpanded = expanded[node.path] ?? depth < 1;
  const directoryLabel = displayDirectoryLabel(node.name);
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        className="group relative flex w-full items-center gap-2.5 py-1.5 pr-2 text-left transition-colors hover:bg-on-surface/[0.035]"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {Array.from({ length: depth }).map((_, idx) => (
          <div
            key={idx}
            className="absolute top-0 bottom-0 w-[1px] bg-on-surface/[0.03] group-hover:bg-primary/10 transition-colors pointer-events-none"
            style={{ left: 16 + idx * 16 }}
          />
        ))}
        <div className="flex h-4 w-4 shrink-0 items-center justify-center">
            {isExpanded ? (
                <ChevronDown className="h-3 w-3 text-on-surface-variant/40" />
            ) : (
                <ChevronRight className="h-3 w-3 text-on-surface-variant/40" />
            )}
        </div>
        <Folder className={cn("h-3.5 w-3.5 shrink-0 transition-colors", isExpanded ? "text-primary/70" : "text-on-surface/30")} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-black tracking-tight text-on-surface/80">{directoryLabel}</span>
        <span className="font-mono tracking-tight text-[10px] font-bold text-ui-muted/30">{node.children.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {isExpanded ? (
            <motion.div 
              initial={{ opacity: 0, height: 0 }} 
              animate={{ opacity: 1, height: "auto" }} 
              exit={{ opacity: 0, height: 0 }} 
              className="flex flex-col overflow-hidden"
            >
              {node.children.map((child) => (
              <TreeBranch 
                key={child.path} 
                node={child} 
                depth={depth + 1} 
                expanded={expanded} 
                selectedItemId={selectedItemId} 
                onToggle={onToggle} 
                onSelectItem={onSelectItem} 
                onEditItem={onEditItem} 
                acceptedReviewItemIds={acceptedReviewItemIds}
                viewMode={viewMode}
                targetSlotById={targetSlotById}
                placement={placement}
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
