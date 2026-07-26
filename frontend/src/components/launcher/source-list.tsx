import { memo, useRef } from "react";
import { ChevronDown, FileText, FolderOpen, Layers3, ListTree, Trash2 } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  getSourceBehaviorLabel,
  normalizeDirectoryMode,
  type SourceImportGroupView,
} from "@/lib/launcher-sources";
import { cn } from "@/lib/utils";
import type { SessionSourceSelection } from "@/types/session";

// 扁平化后的虚拟列表行：普通来源行 / 导入组头 / 导入组内嵌行。
export type LauncherSourceListItem =
  | { kind: "source"; key: string; source: SessionSourceSelection }
  | { kind: "group-header"; key: string; group: SourceImportGroupView }
  | { kind: "group-source"; key: string; source: SessionSourceSelection; isFirst: boolean; isLast: boolean };

interface SourceRowProps {
  item: SessionSourceSelection;
  nested?: boolean;
  loading: boolean;
  onRemove: (path: string, sourceType: SessionSourceSelection["source_type"]) => void;
  onImportInternal: (item: SessionSourceSelection) => void;
  onSetAtomicMode: (path: string) => void;
}

const SourceRow = memo(function SourceRow({
  item,
  nested = false,
  loading,
  onRemove,
  onImportInternal,
  onSetAtomicMode,
}: SourceRowProps) {
  const isDirectory = item.source_type === "directory";
  const isAtomic = normalizeDirectoryMode(item) === "atomic";

  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-3 transition-all active:scale-[0.995]",
        nested
          ? "rounded-md border border-on-surface/6 bg-surface px-2.5 py-1.5 hover:border-on-surface/16"
          : "rounded-lg border border-on-surface/8 bg-surface-container-lowest px-3 py-2 hover:border-on-surface/20",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className={cn(
          "flex shrink-0 items-center justify-center rounded bg-primary/10 text-primary",
          nested ? "h-7.5 w-7.5" : "h-8.5 w-8.5",
        )}>
          {isDirectory ? (
            <FolderOpen className={cn("text-primary", nested ? "h-3.5 w-3.5" : "h-4 w-4")} />
          ) : (
            <FileText className={cn("text-primary", nested ? "h-3.5 w-3.5" : "h-4 w-4")} />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("truncate font-black tracking-tight text-on-surface", nested ? "text-[12.5px]" : "text-[13.5px]")}>
              {item.path.split(/[\\/]/).pop() || item.path}
            </span>
            <span className="shrink-0 rounded bg-on-surface/5 px-1 py-0.2 text-[8px] font-black uppercase tracking-wider text-ui-muted opacity-80 scale-90 origin-left">
              {getSourceBehaviorLabel(item)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 leading-none">
            <span className="truncate font-mono text-[9.5px] font-medium text-ui-muted opacity-40 uppercase tracking-tighter max-w-[280px] sm:max-w-[400px]" title={item.path}>
              {item.path}
            </span>
            {isDirectory && (
              <>
                <span className="text-[9px] text-ui-muted opacity-25 select-none">·</span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    if (isAtomic) {
                      onImportInternal(item);
                    } else {
                      onSetAtomicMode(item.path);
                    }
                  }}
                  className="shrink-0 text-[9.5px] font-bold text-primary hover:underline transition-colors leading-none"
                >
                  {isAtomic ? "导入内部项" : "改为整体移动"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(item.path, item.source_type)}
        disabled={loading}
        className="shrink-0 rounded-[4px] p-1.5 text-on-surface-variant/40 transition-colors hover:bg-error/10 hover:text-error opacity-0 group-hover:opacity-100 focus:opacity-100"
        title="移除"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
});

interface SourceGroupHeaderProps {
  groupId: string;
  sourcePath: string;
  expanded: boolean;
  itemCount: number;
  loading: boolean;
  onToggleExpanded: (groupId: string) => void;
  onRemoveGroup: (groupId: string) => void;
}

const SourceGroupHeader = memo(function SourceGroupHeader({
  groupId,
  sourcePath,
  expanded,
  itemCount,
  loading,
  onToggleExpanded,
  onRemoveGroup,
}: SourceGroupHeaderProps) {
  return (
    <div
      onClick={() => onToggleExpanded(groupId)}
      className="flex items-start justify-between gap-3 cursor-pointer hover:bg-primary/[0.03] -m-2 p-2 rounded-lg transition-colors select-none"
    >
      <div className="min-w-0 flex items-start gap-2">
        <div className="mt-1 shrink-0 flex items-center justify-center">
          <ChevronDown className={cn("h-4 w-4 text-primary/70 transition-transform duration-200", !expanded && "-rotate-90")} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-primary/70 shrink-0" />
            <p className="text-[13px] font-black tracking-tight text-on-surface">
              已从 {sourcePath.split(/[\\/]/).pop()} 导入 {itemCount} 项
            </p>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] font-bold text-ui-muted opacity-40 uppercase tracking-widest">
            批量导入 · {sourcePath}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={loading}
          onClick={(e) => {
            e.stopPropagation();
            onRemoveGroup(groupId);
          }}
          className="rounded-[6px] px-2.5 py-1.5 text-[10.5px] font-bold text-ui-muted/55 transition-colors hover:bg-error/10 hover:text-error"
        >
          移除整组
        </button>
      </div>
    </div>
  );
});

interface SourceListPanelProps {
  items: LauncherSourceListItem[];
  loading: boolean;
  stats: { total: number; directoryCount: number; fileCount: number };
  showClearConfirm: boolean;
  onClearSources: () => void;
  onRemoveSource: (path: string, sourceType: SessionSourceSelection["source_type"]) => void;
  onImportInternal: (item: SessionSourceSelection) => void;
  onSetAtomicMode: (path: string) => void;
  onToggleGroupExpanded: (groupId: string) => void;
  onRemoveGroup: (groupId: string) => void;
}

export function SourceListPanel({
  items,
  loading,
  stats,
  showClearConfirm,
  onClearSources,
  onRemoveSource,
  onImportInternal,
  onSetAtomicMode,
  onToggleGroupExpanded,
  onRemoveGroup,
}: SourceListPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (items[index]?.kind === "group-header" ? 84 : 62),
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 8,
  });

  return (
    <div className="overflow-hidden rounded-[10px] border border-on-surface/8 bg-surface-container-lowest">
      <div className="flex items-center justify-between border-b border-on-surface/6 px-3 py-2 bg-on-surface/[0.015]">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-on-surface/5 text-primary">
            <ListTree className="h-3.5 w-3.5" />
          </span>
          <span className="text-[11px] font-black tracking-widest text-ui-muted flex items-center gap-1.5">
            <span>已加入来源</span>
            <span className="text-[10px] font-medium text-ui-muted opacity-50 tracking-normal font-sans">（文件夹已优先置顶显示）</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] font-bold text-ui-muted/55">
            文件夹 {stats.directoryCount} · 文件 {stats.fileCount}
          </span>
          <button
            type="button"
            onClick={onClearSources}
            disabled={loading || stats.total === 0}
            className={cn(
              "inline-flex items-center gap-1 rounded-[6px] border px-2.5 py-1 text-[10.5px] font-bold transition-all disabled:opacity-40",
              showClearConfirm
                ? "border-error/30 bg-error/10 text-error animate-pulse"
                : "border-on-surface/8 bg-surface text-on-surface/55 hover:border-error/20 hover:bg-error/5 hover:text-error"
            )}
            title={showClearConfirm ? "再次点击以确认清空" : "一键清空当前来源列表"}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {showClearConfirm ? "确认清空？" : "清空来源"}
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="max-h-[42vh] min-h-[180px] overflow-y-auto p-2 scrollbar-thin">
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const listItem = items[virtualRow.index];
            if (!listItem) {
              return null;
            }
            const isLastOverall = virtualRow.index === items.length - 1;
            // 行间距：普通行/组头之间保持原 gap-2；展开的组头与组内行、组内行之间保持连续卡片外观。
            const spacingClass =
              isLastOverall
                || (listItem.kind === "group-header" && listItem.group.expanded)
                || (listItem.kind === "group-source" && !listItem.isLast)
                ? ""
                : "pb-2";
            return (
              <div
                key={listItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className={cn("absolute left-0 top-0 w-full", spacingClass)}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {listItem.kind === "source" ? (
                  <SourceRow
                    item={listItem.source}
                    loading={loading}
                    onRemove={onRemoveSource}
                    onImportInternal={onImportInternal}
                    onSetAtomicMode={onSetAtomicMode}
                  />
                ) : listItem.kind === "group-header" ? (
                  <div
                    className={cn(
                      "border-primary/20 bg-primary/[0.04] text-on-surface/80",
                      listItem.group.expanded ? "rounded-t-xl border-x border-t px-3 pt-3" : "rounded-xl border p-3",
                    )}
                  >
                    <SourceGroupHeader
                      groupId={listItem.group.group_id}
                      sourcePath={listItem.group.source_path}
                      expanded={listItem.group.expanded}
                      itemCount={listItem.group.items.length}
                      loading={loading}
                      onToggleExpanded={onToggleGroupExpanded}
                      onRemoveGroup={onRemoveGroup}
                    />
                  </div>
                ) : (
                  <div
                    className={cn(
                      "border-x border-primary/20 bg-primary/[0.04] px-3",
                      listItem.isFirst && "pt-3",
                      listItem.isLast && "rounded-b-xl border-b pb-3",
                    )}
                  >
                    <div className={cn(listItem.isFirst ? "border-t border-primary/10 pt-3" : "pt-2")}>
                      <SourceRow
                        item={listItem.source}
                        nested
                        loading={loading}
                        onRemove={onRemoveSource}
                        onImportInternal={onImportInternal}
                        onSetAtomicMode={onSetAtomicMode}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
