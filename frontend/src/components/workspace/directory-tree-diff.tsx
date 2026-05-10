"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, File, FileWarning, Folder, FolderOpen, Layers } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
}

interface DirectoryTreeNode {
  name: string;
  path: string;
  kind: "directory" | "file";
  children: DirectoryTreeNode[];
  status?: DirectoryTreeLeafStatus;
  descendantFileCount: number;
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

  const ensureDirectory = (parts: string[]) => {
    let current = root;
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let child = current.children.find((node) => node.kind === "directory" && node.name === part);
      if (!child) {
        child = {
          name: part,
          path: currentPath,
          kind: "directory",
          children: [],
          descendantFileCount: 0,
        };
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
    let fileNode = parent.children.find((node) => node.kind === "file" && node.name === filename);
    if (!fileNode) {
      fileNode = {
        name: filename,
        path: filePath,
        kind: "file",
        children: [],
        status: entry.status || "pending",
        descendantFileCount: 1,
      };
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
      return a.name.localeCompare(b.name, "zh-CN");
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
      return 1;
    }
    node.descendantFileCount = node.children.reduce((sum, child) => sum + computeCounts(child), 0);
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

function DirectoryTreePanel({ column, filter = "all" }: { column: DirectoryTreeColumnData; filter?: DirectoryTreeFilter }) {
  const tree = useMemo(() => buildTree(column, filter), [column, filter]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      for (const node of tree) {
        if (!(node.path in next)) {
          next[node.path] = true;
        }
      }
      return next;
    });
  }, [tree]);

  const toggle = (path: string) => {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const renderNode = (node: DirectoryTreeNode, depth: number) => {
    if (node.kind === "file") {
      const badge = statusBadge(node.status);
      const isReviewFile = node.path.split("/")[0]?.toLowerCase() === "review" || node.status === "review";
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
          
          {isReviewFile ? (
            <FileWarning className="h-3.5 w-3.5 shrink-0 text-warning/70" />
          ) : (
            <File className={cn(
              "h-3.5 w-3.5 shrink-0 transition-colors",
              isAdded ? "text-success/50" : isFailed ? "text-error/50" : "text-on-surface-variant/25"
            )} />
          )}
          <span 
            title={node.name}
            className={cn(
            "min-w-0 flex-1 truncate font-mono text-[11.5px] tracking-tight transition-colors",
            isReviewFile ? "text-warning font-black" : 
            isAdded ? "text-success-dim/80 font-bold" :
            isFailed ? "text-error/70 font-bold" :
            "text-on-surface/60 group-hover:text-on-surface"
          )}>
            {node.name}
          </span>
          {badge && (
            <span className={cn("shrink-0 rounded-[3px] border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest whitespace-nowrap opacity-80", badge.className)}>
              {badge.label}
            </span>
          )}
        </div>
      );
    }

    const isExpanded = expanded[node.path] ?? depth === 0;
    const isReviewDirectory = node.path.toLowerCase() === "review" || node.path.toLowerCase().startsWith("review/");
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
          <span title={displayPathSegment(node.name)} className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-black tracking-tight text-on-surface/80">{displayPathSegment(node.name)}</span>
          <span className="shrink-0 font-mono text-[10px] font-bold text-ui-muted opacity-40">
            {node.descendantFileCount}
          </span>
          {isReviewDirectory ? (
            <span className="shrink-0 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-warning-dim/80">
              待确认
            </span>
          ) : null}
        </button>

        {isExpanded ? (
          <div className="flex flex-col">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="border-b border-on-surface/8 bg-on-surface/[0.015] px-4 py-1.5">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface/50 truncate">
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

export function DirectoryTreeDiff({ before, after, filter = "all" }: DirectoryTreeDiffProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <DirectoryTreePanel column={before} filter={filter} />
      <DirectoryTreePanel column={after} filter={filter} />
    </div>
  );
}
