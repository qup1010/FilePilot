"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Clock, FolderOpen, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { IconWorkbenchHistoryItem } from "@/types/icon-workbench";

interface IconWorkbenchHistoryDrawerProps {
  open: boolean;
  items: IconWorkbenchHistoryItem[];
  loading: boolean;
  error: string | null;
  activeSessionId?: string | null;
  openingSessionId?: string | null;
  deletingSessionId?: string | null;
  onClose: () => void;
  onReload: () => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function countSummary(item: IconWorkbenchHistoryItem): string {
  return `${item.folder_count} 个文件夹 · ${item.ready_count} 个预览图 · ${item.applied_count} 个已应用`;
}

export function IconWorkbenchHistoryDrawer({
  open,
  items,
  loading,
  error,
  activeSessionId,
  openingSessionId,
  deletingSessionId,
  onClose,
  onReload,
  onOpenSession,
  onDeleteSession,
}: IconWorkbenchHistoryDrawerProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[68] bg-black/20 backdrop-blur-[2px] transition-opacity duration-200 ease-out starting:opacity-0" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-[76] flex h-full w-full max-w-[520px] flex-col border-l-2 border-on-surface/12 bg-surface-container-lowest shadow-2xl outline-none transition-transform duration-300 ease-out starting:translate-x-full">
          <header className="flex items-center justify-between border-b border-on-surface/6 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
                <Clock className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <DialogPrimitive.Title asChild>
                  <h2 className="truncate text-[16px] font-black tracking-tight text-on-surface">历史工作区</h2>
                </DialogPrimitive.Title>
                <DialogPrimitive.Description asChild>
                  <p className="mt-0.5 text-[11px] text-ui-muted">按上次修改时间显示最近 20 条记录</p>
                </DialogPrimitive.Description>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onReload}
                className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ui-muted transition-colors hover:bg-on-surface/4 hover:text-on-surface"
                title="刷新历史工作区"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </button>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ui-muted transition-colors hover:bg-on-surface/4 hover:text-on-surface"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
            {error ? (
              <div className="mb-3 rounded-[8px] border border-error/15 bg-error/5 px-3 py-2 text-[12px] font-bold text-error">
                {error}
              </div>
            ) : null}

            {loading && items.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-ui-muted">
                <LoaderCircle className="h-5 w-5 animate-spin text-primary/50" />
                <p className="text-[12px] font-bold">正在读取历史工作区...</p>
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-ui-muted">
                <FolderOpen className="h-6 w-6 text-on-surface/20" />
                <p className="text-[12px] font-bold">还没有可恢复的图标工作区</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {items.map((item) => {
                  const isActive = item.session_id === activeSessionId;
                  const isOpening = openingSessionId === item.session_id;
                  const isDeleting = deletingSessionId === item.session_id;
                  const targetPreview = item.target_paths.length > 0 ? item.target_paths.join(" · ") : "尚未记录目标路径";
                  return (
                    <div
                      key={item.session_id}
                      className={cn(
                        "rounded-[8px] border px-3 py-3 transition-colors",
                        isActive
                          ? "border-primary/20 bg-primary/5"
                          : "border-on-surface/6 bg-surface-container-low hover:border-on-surface/12",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[13px] font-black text-on-surface">
                              上次修改 {formatUpdatedAt(item.updated_at)}
                            </p>
                            {isActive ? (
                              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-black text-primary">
                                当前
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-[11px] font-medium text-ui-muted" title={targetPreview}>
                            {targetPreview}
                          </p>
                          <p className="mt-2 text-[11px] font-bold text-ui-muted/80">
                            {countSummary(item)}
                            {item.error_count > 0 ? ` · ${item.error_count} 异常` : ""}
                          </p>
                          {item.last_action_message ? (
                            <p className="mt-1 truncate text-[11px] text-ui-muted/70" title={item.last_action_message}>
                              {item.last_action_message}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => onOpenSession(item.session_id)}
                            disabled={isOpening || isDeleting}
                            className="flex h-8 items-center justify-center rounded-[8px] border border-primary/12 bg-primary/8 px-2.5 text-[11px] font-black text-primary transition-colors hover:bg-primary/14 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isOpening ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : "打开"}
                          </button>
                          <button
                            onClick={() => onDeleteSession(item.session_id)}
                            disabled={isOpening || isDeleting}
                            className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-on-surface/8 bg-on-surface/[0.02] text-ui-muted/45 transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
                            title="删除历史工作区"
                          >
                            {isDeleting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
