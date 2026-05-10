"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, FolderTree, Inbox, Layers3, ScanSearch } from "lucide-react";

import type { SourceTreeEntry } from "@/types/session";
import { cn } from "@/lib/utils";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();
}

function includesPath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

export function IncrementalSelectionView({
  rootDirectoryOptions,
  sourceTreeEntries,
  loading,
  onConfirm,
}: {
  rootDirectoryOptions: string[];
  sourceTreeEntries: SourceTreeEntry[];
  loading: boolean;
  onConfirm: (selectedTargetDirs: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const normalizedRootDirectoryOptions = useMemo(
    () => Array.from(new Set(rootDirectoryOptions.map(normalizePath).filter(Boolean))),
    [rootDirectoryOptions],
  );

  useEffect(() => {
    setSelected([]);
  }, [normalizedRootDirectoryOptions]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const rootEntries = useMemo(
    () =>
      sourceTreeEntries.filter((entry) => {
        const relpath = normalizePath(entry.source_relpath);
        return relpath && !relpath.includes("/");
      }),
    [sourceTreeEntries],
  );
  const pendingEntries = useMemo(
    () =>
      rootEntries.filter((entry) => {
        const relpath = normalizePath(entry.source_relpath);
        return !selectedSet.has(relpath);
      }),
    [rootEntries, selectedSet],
  );

  return (
    <div className="flex h-full flex-col bg-surface overflow-hidden">
      <div className="border-b border-on-surface/8 bg-on-surface/[0.02] px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-primary">
              <Layers3 className="h-3.5 w-3.5" />
              归入已有目录
            </div>
            <h2 className="text-[17px] font-black tracking-tight text-on-surface">选择目标目录池</h2>
            <p className="max-w-[600px] text-[12.5px] font-medium leading-relaxed text-ui-muted opacity-70">
              勾选那些已经整理好的根目录作为“目标”。未勾选的项将被视为本轮待处理文件。
            </p>
          </div>
          <div className="rounded-xl border border-on-surface/8 bg-surface-container-lowest px-4 py-2.5 text-right ring-1 ring-black/[0.02]">
            <div className="text-[10px] font-black uppercase tracking-widest text-ui-muted opacity-40">已选目标</div>
            <div className="mt-0.5 text-[20px] font-black text-on-surface tabular-nums leading-none">{selected.length}</div>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-h-0 overflow-auto px-6 py-5 bg-surface-container-lowest/30">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-on-surface/40">可选目录</span>
                <span className="h-1 w-1 rounded-full bg-on-surface/10" />
                <span className="text-[11px] font-bold text-ui-muted/50">{normalizedRootDirectoryOptions.length} 个候选</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelected(normalizedRootDirectoryOptions)}
                className="rounded-md border border-on-surface/10 bg-surface px-3 py-1.5 text-[11px] font-black text-on-surface hover:bg-on-surface/5 transition-all active:scale-95"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="rounded-md border border-on-surface/10 bg-surface px-3 py-1.5 text-[11px] font-black text-on-surface hover:bg-on-surface/5 transition-all active:scale-95"
              >
                清空
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {normalizedRootDirectoryOptions.length > 0 ? normalizedRootDirectoryOptions.map((path) => {
              const checked = selectedSet.has(path);
              const itemCount = rootEntries.filter((entry) => includesPath(normalizePath(entry.source_relpath), path)).length;
              return (
                <label
                  key={path}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all active:scale-[0.98]",
                    checked
                      ? "border-primary/40 bg-primary/5 ring-1 ring-primary/10"
                      : "border-on-surface/8 bg-surface hover:border-primary/20 hover:bg-on-surface/[0.01]",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setSelected((prev) => {
                        if (event.target.checked) {
                          return [...prev, path];
                        }
                        return prev.filter((value) => value !== path);
                      });
                    }}
                    className="mt-1 h-4 w-4 rounded border-on-surface/20 text-primary focus:ring-primary/30 transition-all"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[13px] font-black text-on-surface">{path}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                       <span className="rounded-[4px] bg-on-surface/[0.05] px-1.5 py-0.5 text-[9px] font-black uppercase text-ui-muted">目标目录</span>
                       <span className="text-[10px] font-bold text-ui-muted/50 font-mono">顶层项 {itemCount}</span>
                    </div>
                  </div>
                </label>
              );
            }) : (
              <div className="col-span-full flex h-40 flex-col items-center justify-center rounded-xl border-2 border-dashed border-warning/20 bg-warning/[0.02] p-8 text-center">
                <p className="text-[13px] font-bold text-warning/80">当前根目录下没有可用的现有目录。</p>
                <p className="mt-1 text-[11px] text-warning/50">建议改用“整理整个目录”模式。</p>
              </div>
            )}
          </div>
        </div>

        <aside className="border-l border-on-surface/8 bg-surface px-5 py-5 overflow-y-auto scrollbar-thin space-y-5">
          <div className="rounded-xl border border-on-surface/10 bg-on-surface/[0.02] p-4">
            <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest text-on-surface/70">
              <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
              逻辑策略
            </div>
            <div className="mt-3 space-y-2 text-[11.5px] font-medium leading-relaxed text-ui-muted opacity-70">
              <p>· 已选目录将被视为“目标池”</p>
              <p>· 未选中的项将进入待整理范围</p>
            </div>
            <button
              type="button"
              onClick={() => onConfirm(selected)}
              disabled={loading || selected.length === 0}
              className="mt-5 flex w-full items-center justify-center rounded-lg bg-on-surface py-2.5 text-[12.5px] font-black text-surface transition-all hover:bg-on-surface/90 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? "正在扫描待整理项..." : "确认并继续"}
            </button>
          </div>

          <div className="rounded-xl border border-on-surface/10 bg-surface overflow-hidden ring-1 ring-black/[0.01]">
            <div className="bg-on-surface/[0.02] border-b border-on-surface/8 px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-on-surface/60">
                    <ScanSearch className="h-3.5 w-3.5 text-primary" />
                    待整理范围
                </div>
                <span className="font-mono text-[10px] font-bold text-ui-muted/40">{pendingEntries.length} 项</span>
            </div>
            <div className="max-h-[480px] overflow-y-auto scrollbar-thin">
              <div className="flex flex-col divide-y divide-on-surface/[0.03]">
                {pendingEntries.length > 0 ? pendingEntries.map((entry) => {
                  const relpath = normalizePath(entry.source_relpath);
                  const isDirectory = ["dir", "directory", "folder"].includes(String(entry.entry_type || "").toLowerCase());
                  return (
                    <div key={relpath} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-on-surface/[0.015]">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-on-surface/5 text-on-surface/30 group-hover:bg-primary/5 group-hover:text-primary/60 transition-colors">
                        {isDirectory ? <FolderTree className="h-3.5 w-3.5" /> : <Inbox className="h-3.5 w-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="truncate font-mono text-[11.5px] font-black text-on-surface/70 group-hover:text-on-surface transition-colors">{entry.display_name}</span>
                        <div className="mt-0.5 truncate font-mono text-[9.5px] text-ui-muted opacity-40 uppercase tracking-tighter">{relpath}</div>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="px-6 py-12 text-center">
                    <p className="text-[11px] font-black uppercase tracking-widest text-success-dim/50">没有待整理项</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
