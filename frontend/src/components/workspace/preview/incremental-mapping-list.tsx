"use client";

import React from "react";
import { FileText, ArrowRight, Edit2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanItem } from "@/types/session";
import { statusMeta } from "./preview-utils";

interface IncrementalMappingListProps {
  items: PlanItem[];
  selectedItemId: string | null;
  onSelectItem: (itemId: string) => void;
  onEditItem: (itemId: string) => void;
  resolveTargetLabel: (item: PlanItem) => string;
  readOnly?: boolean;
}

export function IncrementalMappingList({
  items,
  selectedItemId,
  onSelectItem,
  onEditItem,
  resolveTargetLabel,
  readOnly = false,
}: IncrementalMappingListProps) {
  if (items.length === 0) return null;

  const assignmentCounts = new Map<string, number>();
  items.forEach((item) => {
    const label = resolveTargetLabel(item);
    assignmentCounts.set(label, (assignmentCounts.get(label) || 0) + 1);
  });

  return (
    <section className="rounded-xl border border-on-surface/10 bg-surface-container-low/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="text-[13px] font-black uppercase tracking-wider text-on-surface/80">归属映射清单</h3>
          <p className="text-[11.5px] font-medium text-ui-muted opacity-60">实时显示文件与目标目录的映射关系。</p>
        </div>
        <span className="rounded-full border border-on-surface/12 bg-on-surface/5 px-2.5 py-0.5 text-[10px] font-black text-ui-muted">
          {items.length} 条目
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {Array.from(assignmentCounts.entries())
          .sort((a, b) => a[0].localeCompare(b[0], "zh-CN"))
          .slice(0, 8)
          .map(([label, count]) => (
            <span key={label} className="rounded-md border border-primary/15 bg-primary/[0.03] px-2 py-0.5 text-[10px] font-black text-primary/80 transition-colors hover:bg-primary/[0.06]">
              {label} · {count}
            </span>
          ))}
      </div>

      <div className="mt-4 space-y-1">
        {items.map((item) => {
          const status = statusMeta(item.status);
          const targetLabel = resolveTargetLabel(item);
          const active = selectedItemId === item.item_id;

          return (
            <button
              key={item.item_id}
              type="button"
              onClick={() => onSelectItem(item.item_id)}
              onDoubleClick={() => {
                if (!readOnly) {
                  onEditItem(item.item_id);
                }
              }}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all",
                active 
                  ? "border-primary/30 bg-surface ring-1 ring-primary/10" 
                  : "border-transparent bg-transparent hover:bg-on-surface/[0.025] hover:border-on-surface/8",
              )}
            >
              <FileText className={cn("h-3.5 w-3.5 shrink-0 transition-colors", active ? "text-primary/70" : "text-on-surface-variant/30")} />
              <div className="min-w-0 flex-1 py-0.5">
                <p className={cn("truncate text-[13px] font-black tracking-tight", active ? "text-primary" : "text-on-surface/90")}>{item.display_name}</p>
                <div className="mt-1 flex items-center gap-1.5 overflow-hidden">
                  <p className="truncate font-mono text-[10px] font-medium tracking-tight text-ui-muted/50">
                    {item.source_relpath}
                  </p>
                  <ArrowRight className="h-2.5 w-2.5 shrink-0 text-on-surface/10" />
                  <p className={cn("truncate font-mono text-[10px] font-black tracking-tight", active ? "text-primary/60" : "text-primary/40")}>
                    {targetLabel}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2 shrink-0">
                {item.status !== "assigned" && item.status !== "skipped" && (
                  <span className={cn("rounded-[4px] border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest", status.tone)}>
                    {status.label}
                  </span>
                )}
                
                {!readOnly && (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`编辑 ${item.display_name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditItem(item.item_id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onEditItem(item.item_id);
                      }
                    }}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-md border border-on-surface/10 bg-surface opacity-0 pointer-events-none transition-all hover:bg-on-surface/[0.02] active:scale-90 group-hover:opacity-100 group-hover:pointer-events-auto focus:opacity-100 focus:pointer-events-auto focus:outline-none focus:ring-1 focus:ring-primary/20",
                    )}
                    title="编辑"
                  >
                    <Edit2 className="h-3 w-3 text-on-surface-variant/60" />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
