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
    <div className={cn("flex flex-col", level > 0 && "ml-4 border-l border-on-surface/5 pl-2")}>
      <div
        className="group/header flex items-center justify-between py-1 px-2 rounded hover:bg-surface-container-low/50 cursor-pointer transition-colors"
        onClick={() => onToggle(node.path)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight
            className={cn(
              "w-3 h-3 text-on-surface-variant/30 transition-transform",
              isExpanded ? "rotate-90" : "rotate-0",
              !hasContent && "opacity-0"
            )}
          />
          <Folder className={cn("w-3 h-3 text-on-surface/40", isExpanded && "text-primary/60")} />
          <span className="text-[12px] font-bold text-on-surface truncate tracking-tight">
            {node.name}
          </span>
          {node.items.length > 0 && (
            <span className="text-[9px] font-mono text-on-surface-variant/30 text-nowrap">
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
                const Icon = getFileIcon(item.display_name);
                const isEditing = editingId === item.item_id;
                return (
                  <div key={item.item_id} className="group/item flex flex-col pl-5 pr-1">
                    <div className="flex items-center gap-2 py-0.5 text-[11px] text-on-surface-variant hover:text-on-surface transition-colors">
                      <Icon className="w-2.5 h-2.5 opacity-40 group-hover/item:opacity-90" />
                      <span className="truncate flex-1 tracking-tight">{item.display_name}</span>

                      {!readOnly && onEdit && onMoveToReview && (
                        <div className="opacity-0 group-hover/item:opacity-100 flex items-center gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(item.item_id, item.target_relpath || "");
                            }}
                            className="p-1 hover:bg-primary/10 rounded text-on-surface-variant/50 hover:text-primary transition-colors"
                          >
                            <Edit2 className="w-2.5 h-2.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onMoveToReview(item.item_id);
                            }}
                            className="p-1 hover:bg-warning/10 rounded text-on-surface-variant/50 hover:text-warning transition-colors"
                          >
                            <ArrowRight className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing && setEditValue && setEditingId && handleEditSubmit && (
                      <div className="flex gap-2 py-1 ml-4 border-l border-primary/20 pl-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEditSubmit(item.item_id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="flex-1 bg-surface-container-low border-b border-primary text-[10px] py-0.5 outline-none font-mono"
                        />
                        <button
                          onClick={() => handleEditSubmit(item.item_id)}
                          className="text-[9px] font-black text-primary uppercase"
                        >
                          OK
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
