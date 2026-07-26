"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Folder, FolderOpen, Layers } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getFileIcon, zhCollator } from "./preview/preview-utils";
import { AnimatePresence, motion } from "motion/react";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type DirectoryTreeLeafStatus = "pending" | "success" | "failed" | "review";

export interface DirectoryTreeLeafEntry {
  path: string;
  status?: DirectoryTreeLeafStatus;
}

export type DirectoryTreeFilter = "all" | "failed" | "review" | "added";

export interface DirectoryTreeColumnData {
  title: string;
  subtitle: string;
  leafEntries: DirectoryTreeLeafEntry[];
  directoryEntries?: string[];
  basePath?: string;
  baseLabel?: string;
  emptyLabel?: string;
}

interface DirectoryTreeDiffProps {
  before: DirectoryTreeColumnData;
  after: DirectoryTreeColumnData;
  filter?: DirectoryTreeFilter;
  onOpenExplorer?: (path: string) => void;
}

interface DirectoryTreeNode {
  name: string;
  path: string;
  kind: "directory" | "file";
  children: DirectoryTreeNode[];
  status?: DirectoryTreeLeafStatus;
  descendantFileCount: number;
  hasReviewDescendant?: boolean;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();
}

function relativePathFromBase(path: string, basePath?: string): string {
  const normalized = normalizePath(path);
  const normalizedBase = normalizePath(basePath || "");
  if (!normalizedBase) {
    return normalized;
  }
  if (normalized.toLowerCase() === normalizedBase.toLowerCase()) {
    return "";
  }
  const withSlash = `${normalizedBase}/`;
  if (normalized.toLowerCase().startsWith(withSlash.toLowerCase())) {
    return normalized.slice(withSlash.length);
  }
  return normalized;
}

function displayPathSegment(name: string): string {
  return name.toLowerCase() === "review" ? "待确认区" : name;
}

function buildTree(column: DirectoryTreeColumnData, filter: DirectoryTreeFilter = "all"): DirectoryTreeNode[] {
  const root: DirectoryTreeNode = {
    name: "",
    path: "",
    kind: "directory",
    children: [],
    descendantFileCount: 0,
  };
  const baseRootParts = column.baseLabel ? [column.baseLabel] : [];
  const directoryIndex = new Map<string, DirectoryTreeNode>();
  directoryIndex.set("", root);
  const fileIndex = new Map<string, DirectoryTreeNode>();

  const ensureDirectory = (parts: string[]) => {
    let current = root;
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let child = directoryIndex.get(currentPath);
      if (!child) {
        child = {
          name: part,
          path: currentPath,
          kind: "directory",
          children: [],
          descendantFileCount: 0,
        };
        directoryIndex.set(currentPath, child);
        current.children.push(child);
      }
      current = child;
    }
    return current;
  };

  for (const directoryPath of column.directoryEntries || []) {
    const relative = relativePathFromBase(directoryPath, column.basePath);
    const parts = [...baseRootParts, ...relative.split("/").filter(Boolean)];
    if (!parts.length) {
      continue;
    }
    ensureDirectory(parts);
  }

  // Filtering logic
  const filteredLeafEntries = column.leafEntries.filter(entry => {
    if (filter === "all") return true;
    if (filter === "failed") return entry.status === "failed";
    if (filter === "review") return entry.status === "review";
    if (filter === "added") return entry.status === "pending" || entry.status === "success"; 
    return true;
  });

  for (const entry of filteredLeafEntries) {
    const relative = relativePathFromBase(entry.path, column.basePath);
    const parts = [...baseRootParts, ...relative.split("/").filter(Boolean)];
    if (!parts.length) {
      continue;
    }
    const filename = parts.pop();
    if (!filename) {
      continue;
    }
    const parent = ensureDirectory(parts);
    const filePath = parts.length ? `${parts.join("/")}/${filename}` : filename;
    let fileNode = fileIndex.get(filePath);
    if (!fileNode) {
      fileNode = {
        name: filename,
        path: filePath,
        kind: "file",
        children: [],
        status: entry.status || "pending",
        descendantFileCount: 1,
      };
      fileIndex.set(filePath, fileNode);
      parent.children.push(fileNode);
    } else {
      fileNode.status = entry.status || fileNode.status;
    }
  }

  const sortNodes = (nodes: DirectoryTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "directory" ? -1 : 1;
      }
      return zhCollator.compare(a.name, b.name);
    });
    for (const node of nodes) {
      if (node.kind === "directory") {
        sortNodes(node.children);
      }
    }
  };

  const computeCounts = (node: DirectoryTreeNode): number => {
    if (node.kind === "file") {
      node.descendantFileCount = 1;
      node.hasReviewDescendant = node.status === "review";
      return 1;
    }
    node.descendantFileCount = node.children.reduce((sum, child) => sum + computeCounts(child), 0);
    node.hasReviewDescendant = node.children.some((child) => child.hasReviewDescendant);
    return node.descendantFileCount;
  };

  sortNodes(root.children);
  computeCounts(root);

  // If filtering is on, we might want to hide empty directories
  const pruneEmptyDirs = (nodes: DirectoryTreeNode[]): DirectoryTreeNode[] => {
    return nodes.filter(node => {
      if (node.kind === "file") return true;
      node.children = pruneEmptyDirs(node.children);
      return node.children.length > 0;
    });
  };

  if (filter !== "all") {
    return pruneEmptyDirs(root.children);
  }

  return root.children;
}

function statusBadge(status: DirectoryTreeLeafStatus | undefined) {
  if (status === "review") {
    return {
      label: "待核对",
      className: "border-warning/30 bg-warning/10 text-warning font-bold",
    };
  }
  if (status === "failed") {
    return {
      label: "阻断",
      className: "border-error/20 bg-error-container/20 text-error font-bold",
    };
  }
  if (status === "success") {
    return {
      label: "已完成",
      className: "border-success/20 bg-success/10 text-success-dim font-bold",
    };
  }
  // No badge for pending - it's the default state
  return null;
}

function DirectoryTreePanel({ 
  column, 
  filter = "all",
  tree,
  expanded,
  setExpanded,
  onOpenExplorer,
}: { 
  onOpenExplorer?: (path: string) => void;
  column: DirectoryTreeColumnData; 
  filter?: DirectoryTreeFilter;
  tree: DirectoryTreeNode[];
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  useEffect(() => {
    setExpanded((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const node of tree) {
        if (!(node.path in next)) {
          next[node.path] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tree, setExpanded]);

  const getPhysicalPath = (nodePath: string) => {
    if (!column.basePath) return "";
    const relative = relativePathFromBase(nodePath, column.baseLabel);
    if (!relative) return column.basePath;
    return `${column.basePath.replace(/[\\/]+$/, "")}/${relative}`;
  };

  const toggle = (path: string) => {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const renderNode = (node: DirectoryTreeNode, depth: number) => {
    if (node.kind === "file") {
      const badge = statusBadge(node.status);
      const isReviewFile = node.status === "review" || node.path.split("/")[0]?.toLowerCase() === "review";
      const isAdded = node.status === "pending" || node.status === "success";
      const isFailed = node.status === "failed";
      
      return (
        <div key={node.path} className={cn(
          "group relative flex items-center gap-2.5 px-2 py-0.5 transition-all border-l border-transparent hover:bg-on-surface/[0.025] hover:border-on-surface/10",
          isReviewFile && "hover:bg-warning/[0.03] hover:border-warning/20",
          isFailed && "hover:bg-error/[0.03] hover:border-error/20",
          isAdded && "hover:bg-success/[0.03] hover:border-success/20"
        )}
             style={{ paddingLeft: `${14 + depth * 16}px` }}>
          
          {/* Connector Line */}
          <div className="absolute left-[-1px] top-0 bottom-0 w-[1px] bg-on-surface/5" 
               style={{ left: `${6 + depth * 16}px` }} />
          
          {(() => {
            const ItemIcon = getFileIcon(node.name);
            return (
              <ItemIcon className={cn(
                "h-3.5 w-3.5 shrink-0 transition-colors",
                isReviewFile ? "text-warning/70" :
                isAdded ? "text-success/50" :
                isFailed ? "text-error/50" :
                "text-on-surface-variant/25"
              )} />
            );
          })()}
          <span 
            title={node.name}
            className={cn(
            "min-w-0 flex-1 truncate font-mono text-[13px] font-bold tracking-tight transition-colors",
            isReviewFile ? "text-warning font-black" : 
            isAdded ? "text-success-dim/80 font-bold" :
            isFailed ? "text-error/70 font-bold" :
            "text-on-surface/60 group-hover:text-on-surface"
          )}>
            {node.name}
          </span>
          {onOpenExplorer && column.basePath && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenExplorer(getPhysicalPath(node.path));
              }}
              title="在物理资源管理器中显示"
              className="opacity-0 group-hover:opacity-100 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] hover:bg-on-surface/5 text-ui-muted hover:text-primary transition-all active:scale-90"
            >
              <FolderOpen className="h-3 w-3" />
            </button>
          )}
          {badge && (
            <span className={cn("shrink-0 rounded-[4px] border px-1.5 py-0.5 text-[11px] font-black uppercase tracking-widest whitespace-nowrap opacity-80", badge.className)}>
              {badge.label}
            </span>
          )}
        </div>
      );
    }

    const isExpanded = expanded[node.path] ?? depth === 0;
    const isReviewDirectory = Boolean(node.hasReviewDescendant)
      || node.path.toLowerCase() === "review"
      || node.path.toLowerCase().startsWith("review/");
    return (
      <div key={node.path} className="relative">
        <button
          type="button"
          onClick={() => toggle(node.path)}
          className="group flex w-full items-center gap-2.5 px-2 py-1 text-left transition-colors hover:bg-on-surface/[0.03]"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {/* Connector Line for Dirs */}
          {depth > 0 && (
            <div className="absolute left-[-1px] top-0 h-full w-[1px] bg-on-surface/5" 
                 style={{ left: `${6 + depth * 16}px` }} />
          )}

          <div className="flex h-4 w-4 shrink-0 items-center justify-center">
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-on-surface-variant/40" />
            ) : (
              <ChevronRight className="h-3 w-3 text-on-surface-variant/40" />
            )}
          </div>
          {isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary/70" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-primary/70" />
          )}
          <span title={displayPathSegment(node.name)} className="min-w-0 flex-1 truncate font-mono text-[13px] font-black tracking-tight text-on-surface/80">{displayPathSegment(node.name)}</span>
          <span className="shrink-0 font-mono text-[11px] font-bold text-ui-muted opacity-40">
            {node.descendantFileCount}
          </span>
          {onOpenExplorer && column.basePath && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onOpenExplorer(getPhysicalPath(node.path));
              }}
              title="在物理资源管理器中打开该文件夹"
              className="opacity-0 group-hover:opacity-100 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] hover:bg-on-surface/5 text-ui-muted hover:text-primary transition-all active:scale-90 cursor-pointer"
            >
              <FolderOpen className="h-3 w-3" />
            </span>
          )}
          {isReviewDirectory ? (
            <span className="shrink-0 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-warning-dim/80">
              待确认
            </span>
          ) : null}
        </button>

        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              className="flex flex-col overflow-hidden"
            >
              {node.children.map((child) => renderNode(child, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="border-b border-on-surface/8 bg-on-surface/[0.015] px-4 py-1.5">
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-on-surface/50 truncate">
          {column.title === "整理前目录树" ? "整理前" : "整理后"} · {column.title}
        </h3>
      </div>

      <div className="mt-4 space-y-1">
        {tree.length > 0 ? (
          tree.map((node) => renderNode(node, 0))
        ) : (
          <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-on-surface/10 bg-on-surface/[0.02] px-6 py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-on-surface/5 text-on-surface/20">
               <Layers className="h-6 w-6" />
            </div>
            <p className="max-w-[200px] text-[13px] font-medium leading-relaxed text-on-surface-variant/60">
              {column.emptyLabel || "当前没有可展示的目录结构。"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function DirectoryTreeDiff({ before, after, filter = "all", onOpenExplorer }: DirectoryTreeDiffProps) {
  const [expandedBefore, setExpandedBefore] = useState<Record<string, boolean>>({});
  const [expandedAfter, setExpandedAfter] = useState<Record<string, boolean>>({});

  const beforeTree = useMemo(() => buildTree(before, filter), [before, filter]);
  const afterTree = useMemo(() => buildTree(after, filter), [after, filter]);

  const handleCollapseAll = () => {
    const nextBefore: Record<string, boolean> = {};
    const nextAfter: Record<string, boolean> = {};
    
    const traverse = (nodes: DirectoryTreeNode[], next: Record<string, boolean>) => {
      nodes.forEach((n) => {
        if (n.kind === "directory") {
          next[n.path] = false;
          traverse(n.children, next);
        }
      });
    };
    
    traverse(beforeTree, nextBefore);
    traverse(afterTree, nextAfter);
    setExpandedBefore(nextBefore);
    setExpandedAfter(nextAfter);
  };

  const handleExpandAll = () => {
    const nextBefore: Record<string, boolean> = {};
    const nextAfter: Record<string, boolean> = {};
    
    const traverse = (nodes: DirectoryTreeNode[], next: Record<string, boolean>) => {
      nodes.forEach((n) => {
        if (n.kind === "directory") {
          next[n.path] = true;
          traverse(n.children, next);
        }
      });
    };
    
    traverse(beforeTree, nextBefore);
    traverse(afterTree, nextAfter);
    setExpandedBefore(nextBefore);
    setExpandedAfter(nextAfter);
  };

  const treeShortcutsRef = useRef({ expandAll: handleExpandAll, collapseAll: handleCollapseAll });
  useEffect(() => {
    treeShortcutsRef.current = { expandAll: handleExpandAll, collapseAll: handleCollapseAll };
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        treeShortcutsRef.current.expandAll();
      } else if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        treeShortcutsRef.current.collapseAll();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="flex items-center justify-end gap-1.5 border-b border-on-surface/5 pb-3">
        <button
          type="button"
          title="全部收起 (Ctrl+Alt+C)"
          onClick={handleCollapseAll}
          className="flex h-7 px-2.5 items-center gap-1.5 rounded-md border border-on-surface/8 bg-surface text-[11px] font-black text-ui-muted hover:bg-on-surface/5 active:scale-95 transition-all select-none"
        >
          <ChevronsDownUp className="h-3.5 w-3.5" />
          <span>全部收起</span>
        </button>
        <button
          type="button"
          title="全部展开 (Ctrl+Alt+E)"
          onClick={handleExpandAll}
          className="flex h-7 px-2.5 items-center gap-1.5 rounded-md border border-on-surface/8 bg-surface text-[11px] font-black text-ui-muted hover:bg-on-surface/5 active:scale-95 transition-all select-none"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
          <span>全部展开</span>
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DirectoryTreePanel 
          column={before} 
          filter={filter} 
          tree={beforeTree}
          expanded={expandedBefore}
          setExpanded={setExpandedBefore}
          onOpenExplorer={onOpenExplorer}
        />
        <DirectoryTreePanel 
          column={after} 
          filter={filter} 
          tree={afterTree}
          expanded={expandedAfter}
          setExpanded={setExpandedAfter}
          onOpenExplorer={onOpenExplorer}
        />
      </div>
    </div>
  );
}
