"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Folder,
  ChevronRight,
  FileText,
  FileImage,
  Download,
  CreditCard,
  Edit2,
  ArrowRight,
} from "lucide-react";
import { PlanItem, PlanGroup } from "@/types/session";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const getFileIcon = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext)) return FileImage;
  if (["pdf", "doc", "docx", "txt", "md"].includes(ext)) return FileText;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return Download;
  if (["xls", "xlsx", "csv"].includes(ext)) return CreditCard;
  return FileText;
};

const getEntryIcon = (item: Pick<PlanItem, "display_name" | "entry_type">) => {
  if (item.entry_type === "dir") return Folder;
  return getFileIcon(item.display_name);
};

// 树节点接口
export interface TreeNode {
  name: string;
  path: string;
  items: PlanItem[];
  children: Record<string, TreeNode>;
}

// 将扁平分组构建成树
export function buildFileTree(groups: PlanGroup[]): TreeNode {
  const root: TreeNode = { name: "Root", path: "", items: [], children: {} };

  groups.forEach((group) => {
    const parts = group.directory.split("/").filter(Boolean);
    let current = root;

    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: path,
          items: [],
          children: {},
        };
      }
      current = current.children[part];
      if (index === parts.length - 1) {
        current.items = group.items;
      }
    });
  });

  return root;
}

// 根据原始路径构建“整理前”的树
export function buildOriginalTree(items: PlanItem[]): TreeNode {
  const root: TreeNode = { name: "Root", path: "", items: [], children: {} };

  items.forEach((item) => {
    const relDir = item.source_relpath.includes("/") 
      ? item.source_relpath.split("/").slice(0, -1).join("/")
      : ".";
    
    const parts = relDir === "." ? [] : relDir.split("/").filter(Boolean);
    let current = root;

    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: path,
          items: [],
          children: {},
        };
      }
      current = current.children[part];
    });

    current.items.push(item);
  });

  return root;
}

interface FolderNodeProps {
  node: TreeNode;
  level: number;
  readOnly: boolean;
  expandedGroups: Record<string, boolean>;
  onToggle: (path: string) => void;
  // 操作回调
  editingId?: string | null;
  editValue?: string;
  onEdit?: (itemId: string, currentPath: string) => void;
  onMoveToReview?: (itemId: string) => void;
  setEditingId?: (id: string | null) => void;
  setEditValue?: (val: string) => void;
  handleEditSubmit?: (itemId: string) => void;
}

function FolderNode({
  node,
  level,
  readOnly,
  expandedGroups,
  onToggle,
  editingId,
  editValue,
  onEdit,
  onMoveToReview,
  setEditingId,
  setEditValue,
  handleEditSubmit,
}: FolderNodeProps) {
  const isExpanded = expandedGroups[node.path] ?? true;
  const hasContent = node.items.length > 0 || Object.keys(node.children).length > 0;

  if (node.path === "" && level === 0) {
    return (
      <div className="space-y-0.5">
        {Object.values(node.children).map((child) => (
          <FolderNode
            key={child.path}
            node={child}
            level={level}
            readOnly={readOnly}
            expandedGroups={expandedGroups}
            onToggle={onToggle}
            editingId={editingId}
            editValue={editValue}
            onEdit={onEdit}
            onMoveToReview={onMoveToReview}
            setEditingId={setEditingId}
            setEditValue={setEditValue}
            handleEditSubmit={handleEditSubmit}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col relative", level > 0 && "ml-4")}>
      {/* Vertical Tree Line */}
      {level > 0 && (
        <div className="absolute left-[-8px] top-0 bottom-0 w-[1px] bg-on-surface/5" />
      )}
      
      <div
        className="group/header flex cursor-pointer items-center justify-between rounded-lg px-2 py-1 transition-colors hover:bg-surface-container-low/70"
        onClick={() => onToggle(node.path)}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            {hasContent ? (
              isExpanded ? (
                <ChevronRight className="h-3 w-3 rotate-90 text-on-surface-variant/30" />
              ) : (
                <ChevronRight className="h-3 w-3 text-on-surface-variant/30" />
              )
            ) : null}
          </div>
          <Folder className={cn("h-3.5 w-3.5 shrink-0 transition-colors", isExpanded ? "text-primary/70" : "text-on-surface/30")} />
          <span className="truncate font-mono text-[12.5px] font-black tracking-tight text-on-surface/80">
            {node.name}
          </span>
          {node.items.length > 0 && (
            <span className="font-mono text-[10px] font-bold text-ui-muted opacity-40">
              ({node.items.length})
            </span>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-0.5 space-y-0.5">
              {Object.values(node.children).map((child) => (
                <FolderNode
                  key={child.path}
                  node={child}
                  level={level + 1}
                  readOnly={readOnly}
                  expandedGroups={expandedGroups}
                  onToggle={onToggle}
                  editingId={editingId}
                  editValue={editValue}
                  onEdit={onEdit}
                  onMoveToReview={onMoveToReview}
                  setEditingId={setEditingId}
                  setEditValue={setEditValue}
                  handleEditSubmit={handleEditSubmit}
                />
              ))}

              {node.items.map((item) => {
                const Icon = getEntryIcon(item);
                const isEditing = editingId === item.item_id;
                return (
                  <div key={item.item_id} className="group/item relative flex flex-col pl-6 pr-1">
                    {/* Leaf Connector Line */}
                    <div className="absolute left-[-8px] top-0 h-4 w-[1px] bg-on-surface/5" />
                    <div className="absolute left-[-8px] top-4 w-4 h-[1px] bg-on-surface/5" />
                    
                    <div className="flex items-center gap-2.5 py-0.5 transition-colors hover:bg-on-surface/[0.02]">
                      <Icon className="h-3.5 w-3.5 shrink-0 opacity-30 group-hover/item:opacity-60 transition-opacity" />
                      <span className="truncate flex-1 font-mono text-[11.5px] tracking-tight text-on-surface/70 group-hover/item:text-on-surface">{item.display_name}</span>

                      {!readOnly && onEdit && onMoveToReview && (
                        <div className="flex items-center gap-1 transition-all duration-300 opacity-0 pointer-events-none group-hover/item:opacity-100 group-hover/item:pointer-events-auto mr-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(item.item_id, node.path || "");
                            }}
                            className="p-1.5 rounded-md bg-on-surface/5 text-on-surface/30 hover:bg-primary/10 hover:text-primary transition-colors"
                            title="修改文件名"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onMoveToReview(item.item_id);
                            }}
                            className="p-1.5 rounded-md bg-on-surface/5 text-on-surface/30 hover:bg-warning/10 hover:text-warning transition-colors"
                            title="移动至待核对"
                          >
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing && setEditValue && setEditingId && handleEditSubmit && (
                      <div className="flex gap-2 py-1 ml-4 border-l-2 border-primary/20 bg-primary/[0.02] pl-2 pr-2 rounded-r-md" onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEditSubmit(item.item_id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="flex-1 bg-transparent py-0.5 text-[12px] font-black text-primary outline-none font-mono"
                        />
                        <button
                          onClick={() => handleEditSubmit(item.item_id)}
                          className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline"
                        >
                          Confirm
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export interface DirectoryTreeProps {
  root: TreeNode;
  readOnly?: boolean;
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (path: string) => void;
  // 操作可选
  editingId?: string | null;
  editValue?: string;
  onEdit?: (itemId: string, currentPath: string) => void;
  onMoveToReview?: (itemId: string) => void;
  setEditingId?: (id: string | null) => void;
  setEditValue?: (val: string) => void;
  handleEditSubmit?: (itemId: string) => void;
}

export function DirectoryTree({
  root,
  readOnly = true,
  expandedGroups,
  onToggleGroup,
  ...rest
}: DirectoryTreeProps) {
  return (
    <FolderNode
      node={root}
      level={0}
      readOnly={readOnly}
      expandedGroups={expandedGroups}
      onToggle={onToggleGroup}
      {...rest}
    />
  );
}
