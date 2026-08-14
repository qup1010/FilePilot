"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, FolderTree, Inbox, Layers3, ScanSearch } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

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
  onExit,
}: {
  rootDirectoryOptions: string[];
  sourceTreeEntries: SourceTreeEntry[];
  loading: boolean;
  onConfirm: (selectedTargetDirs: string[]) => void;
  onExit?: () => void;
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
      <div className="border-b border-on-surface/8 bg-surface-container-lowest/50 px-6 py-4 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/8 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-widest text-primary">
              <Layers3 className="h-3.5 w-3.5" />
              归入已有目录模式
            </div>
            <h2 className="text-[17px] font-black tracking-tight text-on-surface">选择用于归类的目标文件夹</h2>
            <p className="max-w-[620px] text-[13px] font-medium leading-relaxed text-ui-muted/80">
              请勾选那些已整理好的文件夹作为“目标”。未勾选的文件和文件夹将被识别并自动归入其中。
            </p>
          </div>
          <div className="rounded-xl border border-on-surface/8 bg-surface-container-lowest px-4 py-2.5 text-right shadow-sm">
            <div className="text-[11px] font-black uppercase tracking-widest text-ui-muted/50">已选目标</div>
            <div className="mt-0.5 text-[22px] font-black text-on-surface tabular-nums leading-none">{selected.length}</div>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-h-0 overflow-auto px-6 py-5 bg-surface-container-lowest/30">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-widest text-on-surface/50">可选文件夹</span>
              <span className="h-1 w-1 rounded-full bg-on-surface/15" />
              <span className="text-[11px] font-bold text-ui-muted/70">{normalizedRootDirectoryOptions.length} 个候选</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelected(normalizedRootDirectoryOptions)}
                className="rounded-lg border border-on-surface/10 bg-surface px-3 py-1.5 text-[11px] font-bold text-on-surface hover:bg-on-surface/5 transition-all active:scale-95"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="rounded-lg border border-on-surface/10 bg-surface px-3 py-1.5 text-[11px] font-bold text-on-surface hover:bg-on-surface/5 transition-all active:scale-95"
              >
                清空
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {normalizedRootDirectoryOptions.length > 0 ? normalizedRootDirectoryOptions.map((path) => {
              const checked = selectedSet.has(path);
              const itemCount = rootEntries.filter((entry) => includesPath(normalizePath(entry.source_relpath), path)).length;
              return (
                <label
                  key={path}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all active:scale-[0.98]",
                    checked
                      ? "border-primary/40 bg-primary/[0.04] ring-1 ring-primary/20 shadow-sm"
                      : "border-on-surface/8 bg-surface hover:border-primary/20 hover:bg-on-surface/[0.015]",
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
                      <span className="truncate font-mono text-[13px] font-bold text-on-surface">{path}</span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="rounded-[4px] bg-primary/8 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        目标目录
                      </span>
                      <span className="text-[11px] font-medium text-ui-muted/60 font-mono">
                        已包含 {itemCount} 项
                      </span>
                    </div>
                  </div>
                </label>
              );
            }) : (
              <div className="col-span-full flex h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed border-warning/20 bg-warning/[0.02] p-8 text-center">
                <p className="text-[13px] font-bold text-warning/80">当前根目录下没有可用的现有目录。</p>
                <p className="mt-1 text-[11px] text-warning/60">这个模式需要至少一个已有目录作为归类目标。请结束本次任务，回到首页改用“全量整理”模式重新开始。</p>
                {onExit ? (
                  <button
                    type="button"
                    onClick={onExit}
                    className="mt-4 rounded-[8px] border border-on-surface/10 bg-surface px-4 py-2 text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-on-surface/5"
                  >
                    结束本次任务并返回首页
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <aside className="border-l border-on-surface/8 bg-surface px-5 py-5 overflow-y-auto scrollbar-thin space-y-5">
          <div className="rounded-xl border border-on-surface/10 bg-surface-container-lowest p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-on-surface/80">
              <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
              归类规则说明
            </div>
            <div className="mt-3 space-y-2 text-[12px] font-medium leading-relaxed text-ui-muted/80">
              <p className="flex items-center gap-1.5 text-primary font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                已勾选：作为目标目录（文件归入其中）
              </p>
              <p className="flex items-center gap-1.5 text-ui-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-on-surface/20" />
                未勾选：作为待整理对象（将被归类）
              </p>
            </div>
            <button
              type="button"
              onClick={() => onConfirm(selected)}
              disabled={loading || selected.length === 0}
              className="mt-5 flex w-full items-center justify-center rounded-xl bg-primary py-2.5 text-[13px] font-bold text-white shadow-sm transition-all hover:bg-primary-dim active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? "正在读取待整理项..." : `确认选择并继续 (${selected.length})`}
            </button>
          </div>

          <div className="rounded-xl border border-on-surface/10 bg-surface-container-lowest overflow-hidden shadow-sm">
            <div className="bg-on-surface/[0.02] border-b border-on-surface/8 px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-on-surface/70">
                <ScanSearch className="h-3.5 w-3.5 text-primary" />
                待整理范围
              </div>
              <span className="font-mono text-[11px] font-bold text-ui-muted/60">{pendingEntries.length} 项</span>
            </div>
            <div className="max-h-[480px] overflow-y-auto scrollbar-thin">
              <div className="flex flex-col divide-y divide-on-surface/[0.03]">
                <AnimatePresence initial={false}>
                  {pendingEntries.length > 0 ? pendingEntries.map((entry) => {
                    const relpath = normalizePath(entry.source_relpath);
                    const isDirectory = ["dir", "directory", "folder"].includes(String(entry.entry_type || "").toLowerCase());
                    return (
                      <motion.div
                        key={relpath}
                        layout
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ type: "spring", stiffness: 450, damping: 35 }}
                        className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-on-surface/[0.015] overflow-hidden"
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-on-surface/[0.03] text-on-surface/40 group-hover:bg-primary/5 group-hover:text-primary transition-colors">
                          {isDirectory ? <FolderTree className="h-3.5 w-3.5" /> : <Inbox className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="truncate font-mono text-[12px] font-bold text-on-surface/80 group-hover:text-on-surface transition-colors">{entry.display_name}</span>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-ui-muted/50 tracking-tight">{relpath}</div>
                        </div>
                      </motion.div>
                    );
                  }) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="px-6 py-12 text-center"
                    >
                      <p className="text-[12px] font-bold text-success-dim/70">没有待整理项</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
