"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, File, FileWarning, Folder, FolderOpen } from "lucide-react";
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
      label: "待确认",
      className: "border-warning/30 bg-warning-container/30 text-warning-dim",
    };
  }
  if (status === "failed") {
    return {
      label: "失败",
      className: "border-error/20 bg-error-container/20 text-error",
    };
  }
  if (status === "success") {
    return {
      label: "成功",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600",
    };
  }
  return {
    label: "计划中",
    className: "border-primary/15 bg-primary/8 text-primary",
  };
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
      return (
        <div key={node.path} className="space-y-1">
          <div
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm"
            style={{ paddingLeft: `${12 + depth * 18}px` }}
          >
            {isReviewFile ? (
              <FileWarning className="h-4 w-4 shrink-0 text-warning" />
            ) : (
              <File className="h-4 w-4 shrink-0 text-on-surface-variant/55" />
            )}
            <span className="min-w-0 flex-1 truncate text-on-surface">{node.name}</span>
            <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-black whitespace-nowrap", badge.className)}>
              {badge.label}
            </span>
          </div>
        </div>
      );
    }

    const isExpanded = expanded[node.path] ?? depth === 0;
    const isReviewDirectory = node.path.toLowerCase() === "review" || node.path.toLowerCase().startsWith("review/");
    return (
      <div key={node.path} className="space-y-1">
        <button
          type="button"
          onClick={() => toggle(node.path)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-surface-container-low/70"
          style={{ paddingLeft: `${8 + depth * 18}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-on-surface-variant/60" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-on-surface-variant/60" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-primary" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium text-on-surface">{node.name}</span>
          <span className="shrink-0 text-[12px] font-medium text-on-surface-variant/60">
            {node.descendantFileCount} 项
          </span>
          {isReviewDirectory ? (
            <span className="shrink-0 rounded-full border border-warning/20 bg-warning-container/20 px-2 py-0.5 text-[11px] font-black whitespace-nowrap text-warning-dim/80">
              待确认
            </span>
          ) : null}
        </button>

        {isExpanded ? (
          <div className="space-y-1">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-5 shadow-sm">
      <div className="border-b border-on-surface/6 pb-4">
        <h3 className="text-[14px] font-semibold text-on-surface">{column.title}</h3>
        <p className="mt-1 text-[12px] leading-6 text-on-surface-variant">{column.subtitle}</p>
      </div>

      <div className="mt-4 min-h-[320px] space-y-1">
        {tree.length > 0 ? (
          tree.map((node) => renderNode(node, 0))
        ) : (
          <div className="rounded-[10px] border border-dashed border-on-surface/10 bg-surface-container-low/45 px-4 py-12 text-center text-sm text-on-surface-variant">
            {column.emptyLabel || "当前没有可展示的目录结构。"}
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
