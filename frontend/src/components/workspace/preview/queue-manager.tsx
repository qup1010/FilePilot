"use client";

import React from "react";
import { ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { PlanItem } from "@/types/session";
import { fileExtension, getFileIcon } from "./preview-utils";

interface QueueCardProps {
  title: string;
  items: PlanItem[];
  selectedItemId: string | null;
  onSelectItem: (itemId: string) => void;
  onShowAll: () => void;
  tone: string;
  resolveTargetLabel: (item: PlanItem) => string;
}

export function QueueCard({
  title,
  items,
  selectedItemId,
  onSelectItem,
  onShowAll,
  tone,
  resolveTargetLabel,
}: QueueCardProps) {
  if (items.length === 0) return null;
  return (
    <section className={cn("overflow-hidden rounded-xl border bg-surface shadow-sm", tone)}>
      <div className="flex items-center justify-between gap-3 border-b border-on-surface/8 bg-surface-container-lowest/80 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-[12px] font-black tracking-tight text-on-surface/85">{title}</h3>
          <span className="rounded-full border border-on-surface/10 bg-surface px-2 py-0.5 text-[11px] font-black tabular-nums text-on-surface/70">{items.length}</span>
        </div>
        <button 
          type="button" 
          onClick={onShowAll} 
          className="rounded-md border border-on-surface/8 bg-surface px-2.5 py-1 text-[11px] font-bold text-on-surface/75 transition-all hover:border-primary/30 hover:text-primary active:scale-95"
        >
          查看全部
        </button>
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        {items.slice(0, 4).map((item) => {
          const FileIcon = getFileIcon(item.display_name, item.entry_type);
          return (
            <button
              key={item.item_id}
              type="button"
              onClick={() => onSelectItem(item.item_id)}
              className={cn(
                "group relative flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-200",
                selectedItemId === item.item_id 
                  ? "border-primary/45 bg-primary/[0.045] shadow-sm ring-1 ring-primary/20 scale-[1.01]" 
                  : "border-on-surface/6 bg-surface-container-lowest/40 hover:border-on-surface/15 hover:bg-on-surface/[0.025] hover:scale-[1.005]",
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-on-surface/[0.03] text-primary/70 group-hover:text-primary transition-colors">
                  <FileIcon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate font-mono text-[12px] tracking-tight", selectedItemId === item.item_id ? "font-black text-on-surface" : "font-bold text-on-surface/80")}>
                    {item.display_name}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-ui-muted opacity-60">
                    {resolveTargetLabel(item)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                 <span className="font-mono text-[10px] font-bold text-ui-muted/50 uppercase">{fileExtension(item)}</span>
                 <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity text-primary" />
              </div>
            </button>
          );
        })}
        {items.length > 4 && (
          <button type="button" onClick={onShowAll} className="w-full rounded-lg py-2 text-[11px] font-bold tracking-tight text-ui-muted/70 transition-all hover:bg-on-surface/5 hover:text-on-surface">
            还有 {items.length - 4} 项 · 点击展开
          </button>
        )}
      </div>
    </section>
  );
}

interface QueuePanelProps {
  collapsed: boolean;
  queueCount: number;
  unresolvedCount: number;
  reviewCount: number;
  invalidatedCount: number;
  children: React.ReactNode;
  onToggle: () => void;
  actions?: React.ReactNode;
}

export function QueuePanel({
  collapsed,
  queueCount,
  unresolvedCount,
  reviewCount,
  invalidatedCount,
  children,
  onToggle,
  actions,
}: QueuePanelProps) {
  if (queueCount === 0) return null;
  return (
    <aside className="w-full shrink-0 min-w-0">
      <section className="overflow-hidden rounded-xl border border-on-surface/10 bg-surface shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-on-surface/8 bg-surface-container-lowest/80 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-black tracking-tight text-on-surface/90">待确认队列</h3>
              <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[11px] font-black text-warning tabular-nums">
                {queueCount}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!collapsed}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-on-surface/10 bg-surface px-3 text-[11px] font-bold text-on-surface-variant transition-all hover:bg-surface-container-low hover:text-on-surface active:scale-95"
            >
              {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              {collapsed ? "展开列表" : "收起"}
            </button>
          </div>
        </div>
        <AnimatePresence initial={false} mode="wait">
          {!collapsed ? (
            <motion.div
              key="queue-expanded"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="space-y-3 bg-surface-container-lowest/35 p-3">
                {children}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="queue-collapsed"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-2 px-4 py-3">
                {invalidatedCount > 0 ? (
                  <span className="rounded-md border border-error/20 bg-error/5 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-error animate-[pulse_4s_infinite] shadow-sm">分类变动需确认 {invalidatedCount}</span>
                ) : null}
                {unresolvedCount > 0 ? (
                  <span className="rounded-md border border-warning/25 bg-warning/5 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-warning-dim animate-[pulse_3.5s_infinite] shadow-sm">未分配分类 {unresolvedCount}</span>
                ) : null}
                {reviewCount > 0 ? (
                  <span className="rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-primary animate-[pulse_4.5s_infinite] shadow-sm">暂放待确认 {reviewCount}</span>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </aside>
  );
}
