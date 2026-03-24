"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Folder,
  Layers,
  AlertTriangle,
  Archive,
  Activity,
  RefreshCw,
  ChevronRight,
  FileText,
  FileImage,
  Download,
  CreditCard,
  Edit2,
  ArrowRight,
  FileCode,
  FileVideo,
  FileAudio,
  FileArchive,
  FileJson,
  FileBox,
  FolderPlus,
  Sparkles,
  Check,
} from "lucide-react";
import { PlanSnapshot, SessionStage, PlanItem, PlanGroup } from "@/types/session";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const getFileIcon = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico"].includes(ext)) return FileImage;
  if (["mp4", "mkv", "mov", "avi", "wmv", "flv"].includes(ext)) return FileVideo;
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext)) return FileAudio;
  if (["zip", "rar", "7z", "tar", "gz", "iso"].includes(ext)) return FileArchive;
  if (["js", "ts", "tsx", "jsx", "python", "py", "rs", "go", "cpp", "c", "java", "php"].includes(ext)) return FileCode;
  if (["json", "yaml", "yml", "xml", "toml"].includes(ext)) return FileJson;
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return CreditCard;
  if (["exe", "app", "dmg", "pkg", "msi"].includes(ext)) return FileBox;
  if (["pdf", "doc", "docx", "txt", "md", "ppt", "pptx"].includes(ext)) return FileText;
  return FileText;
};

function findPlanItemForConflict(plan: PlanSnapshot, rawConflict: string): PlanItem | undefined {
  const normalized = rawConflict.trim().toLowerCase();
  const firstToken = rawConflict.match(/^([^\s，,:：]+)/)?.[1]?.toLowerCase();
  return plan.items.find((item) => {
    const candidates = [item.item_id, item.display_name, item.source_relpath]
      .filter(Boolean)
      .map((value) => value.toLowerCase());
    return candidates.some((candidate) => {
      if (candidate === normalized) {
        return true;
      }
      if (firstToken && (candidate === firstToken || candidate.startsWith(firstToken))) {
        return true;
      }
      return normalized.includes(candidate);
    });
  });
}

interface TreeNode {
  name: string;
  path: string;
  items: PlanItem[];
  children: Record<string, TreeNode>;
  item_id?: string; // 如果该目录本身也是一个 item
  hasUnresolved?: boolean;
  hasReview?: boolean;
}

function buildFileTree(groups: PlanGroup[]): TreeNode {
  const root: TreeNode = { name: "Root", path: "", items: [], children: {} };

  groups.forEach((group) => {
    const parts = group.directory.replace(/\\/g, "/").split("/").filter(Boolean);
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

    current.items = [...group.items];
  });

  // 递归计算状态
  const propagateStatus = (node: TreeNode) => {
    // 自身 items 状态
    node.hasUnresolved = node.items.some(it => it.status === "unresolved");
    node.hasReview = node.items.some(it => it.status === "review");

    // 子目录状态冒泡
    Object.values(node.children).forEach(child => {
      propagateStatus(child);
      if (child.hasUnresolved) node.hasUnresolved = true;
      if (child.hasReview) node.hasReview = true;
    });
  };

  propagateStatus(root);
  return root;
}

function buildSourceTree(items: PlanItem[]): TreeNode {
  const root: TreeNode = { name: "Root", path: "", items: [], children: {} };

  items.forEach((item) => {
    // 统一移除尾部斜杠并规范化
    const normalizedPath = item.source_relpath.replace(/\\/g, "/").replace(/\/$/, "");
    const parts = normalizedPath.split("/").filter(Boolean);
    
    let current = root;

    // 前面所有部分都是目录
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const path = parts.slice(0, i + 1).join("/");
      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: path,
          items: [],
          children: {},
        };
      }
      current = current.children[part];
    }

    // 最后一部分可能是文件，也可能是后端标识的目录条目
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      current.items.push(item);
    }
  });

  // 递归计算状态
  const propagateStatus = (node: TreeNode) => {
    node.hasUnresolved = node.items.some(it => it.status === "unresolved");
    node.hasReview = node.items.some(it => it.status === "review");

    Object.values(node.children).forEach(child => {
      propagateStatus(child);
      if (child.hasUnresolved) node.hasUnresolved = true;
      if (child.hasReview) node.hasReview = true;
    });
  };

  propagateStatus(root);
  return root;
}

function buildTargetTree(items: PlanItem[]): TreeNode {
  const root: TreeNode = { name: "Root", path: "", items: [], children: {} };

  items.forEach((item) => {
    const rawTarget = item.target_relpath || item.source_relpath || "";
    const normalizedPath = rawTarget.replace(/\\/g, "/").replace(/\/$/, "");
    const parts = normalizedPath.split("/").filter(Boolean);
    if (parts.length === 0) {
      return;
    }

    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const path = parts.slice(0, i + 1).join("/");
      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path,
          items: [],
          children: {},
        };
      }
      current = current.children[part];
    }

    current.items.push({
      ...item,
      display_name: parts[parts.length - 1] || item.display_name,
    });
  });

  const propagateStatus = (node: TreeNode) => {
    node.hasUnresolved = node.items.some((it) => it.status === "unresolved");
    node.hasReview = node.items.some((it) => it.status === "review");

    Object.values(node.children).forEach((child) => {
      propagateStatus(child);
      if (child.hasUnresolved) node.hasUnresolved = true;
      if (child.hasReview) node.hasReview = true;
    });
  };

  propagateStatus(root);
  return root;
}

interface TreeFolderProps {
  node: TreeNode;
  level: number;
  readOnly: boolean;
  editingId: string | null;
  editValue: string;
  expandedGroups: Record<string, boolean>;
  onToggle: (path: string) => void;
  onEdit: (itemId: string, currentPath: string) => void;
  onMoveToReview: (itemId: string) => void;
  onUpdateItem: (itemId: string, payload: { target_dir?: string; move_to_review?: boolean }) => void;
  setEditingId: (id: string | null) => void;
  setEditValue: (val: string) => void;
  handleEditSubmit: (itemId: string) => void;
}

function FolderNode({
  node,
  level,
  readOnly,
  editingId,
  editValue,
  expandedGroups,
  onToggle,
  onEdit,
  onMoveToReview,
  onUpdateItem,
  setEditingId,
  setEditValue,
  handleEditSubmit,
}: TreeFolderProps) {
  const isExpanded = expandedGroups[node.path] ?? true;
  const hasContent = node.items.length > 0 || Object.keys(node.children).length > 0;

  if (node.path === "" && level === 0) {
    return (
      <div className="space-y-0.5">
        {Object.values(node.children).map((child) => (
          <FolderNode
            key={child.path}
            node={child}
            level={level + 1}
            readOnly={readOnly}
            editingId={editingId}
            editValue={editValue}
            expandedGroups={expandedGroups}
            onToggle={onToggle}
            onEdit={onEdit}
            onMoveToReview={onMoveToReview}
            onUpdateItem={onUpdateItem}
            setEditingId={setEditingId}
            setEditValue={setEditValue}
            handleEditSubmit={handleEditSubmit}
          />
        ))}
        {/* 处理根目录下的孤立文件 */}
        {node.items.map(item => (
          <FileItem 
            key={item.item_id}
            item={item}
            level={level}
            readOnly={readOnly}
            editingId={editingId}
            editValue={editValue}
            setEditingId={setEditingId}
            setEditValue={setEditValue}
            onEdit={onEdit}
            onMoveToReview={onMoveToReview}
            handleEditSubmit={handleEditSubmit}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", level > 0 && "ml-3.5 border-l border-on-surface/5 pl-1.5")}>
      <div 
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded-md transition-all cursor-pointer group",
          isExpanded ? "bg-surface-container-low/30" : "hover:bg-on-surface/2"
        )}
        onClick={() => onToggle(node.path)}
      >
        <div className="flex items-center gap-1.5 shrink-0">
          <ChevronRight 
            className={cn(
              "w-3 h-3 text-on-surface-variant/30 transition-transform duration-200",
              isExpanded && "rotate-90 text-primary/50",
              !hasContent && "opacity-0"
            )} 
          />
          <Folder className={cn("w-3.5 h-3.5 text-on-surface/20", isExpanded && "text-primary/40")} />
        </div>
        <span className={cn(
          "text-[11px] font-bold truncate flex-1 tracking-tight text-on-surface/70",
          (node.hasUnresolved || node.hasReview) && "text-on-surface"
        )}>
          {node.name}
        </span>
        
        {/* 文件夹状态指示灯 */}
        <div className="flex items-center gap-1 pr-1">
          {node.hasUnresolved && <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" title="包含待确认项" />}
          {node.hasReview && <span className="w-1.5 h-1.5 rounded-full bg-primary/40" title="包含待核对项" />}
        </div>
        
        <span className="text-[9px] font-bold text-on-surface-variant/10 tabular-nums">
          {node.items.length + Object.keys(node.children).length}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && hasContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-0.5 space-y-0.5">
              {/* 子目录递归 */}
              {Object.values(node.children).map((child) => (
                <FolderNode
                  key={child.path}
                  node={child}
                  level={level + 1}
                  readOnly={readOnly}
                  editingId={editingId}
                  editValue={editValue}
                  expandedGroups={expandedGroups}
                  onToggle={onToggle}
                  onEdit={onEdit}
                  onMoveToReview={onMoveToReview}
                  onUpdateItem={onUpdateItem}
                  setEditingId={setEditingId}
                  setEditValue={setEditValue}
                  handleEditSubmit={handleEditSubmit}
                />
              ))}

              {/* 文件条目渲染 */}
              {node.items.map((item) => {
                const isDirItem = !item.display_name.includes('.') && node.children[item.display_name];
                if (isDirItem) return null;
                
                return (
                  <FileItem 
                    key={item.item_id}
                    item={item}
                    level={level + 1}
                    readOnly={readOnly}
                    editingId={editingId}
                    editValue={editValue}
                    setEditingId={setEditingId}
                    setEditValue={setEditValue}
                    onEdit={onEdit}
                    onMoveToReview={onMoveToReview}
                    handleEditSubmit={handleEditSubmit}
                  />
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FileItem({ 
  item, 
  level, 
  readOnly, 
  editingId, 
  editValue, 
  setEditingId, 
  setEditValue, 
  onEdit, 
  onMoveToReview, 
  handleEditSubmit 
}: { 
  item: PlanItem; 
  level: number; 
  readOnly: boolean; 
  editingId: string | null; 
  editValue: string;
  setEditingId: (id: string | null) => void;
  setEditValue: (val: string) => void;
  onEdit: (id: string, path: string) => void;
  onMoveToReview: (id: string) => void;
  handleEditSubmit: (id: string) => void;
}) {
  const isFile = item.display_name.includes(".");
  const Icon = isFile ? getFileIcon(item.display_name) : Folder;
  const isEditing = editingId === item.item_id;
  const isUnresolved = item.status === "unresolved";
  const isReview = item.status === "review";
  const hoverDetails = [
    item.suggested_purpose ? `用途：${item.suggested_purpose}` : "",
    item.content_summary ? `内容：${item.content_summary}` : "",
  ].filter(Boolean);
  const tooltipText = hoverDetails.join("\n");

  return (
    <div 
      className={cn(
        "group/item relative flex flex-col pr-1 py-1 my-0.5 rounded-md transition-all",
        isUnresolved ? "bg-warning/5 hover:bg-warning/10" : isReview ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-on-surface/2"
      )}
      style={{ paddingLeft: `${level * 12 + 20}px` }}
      title={tooltipText || undefined}
    >
      <div className="flex items-center gap-2 text-[11px] text-on-surface-variant/70 hover:text-on-surface transition-colors">
        <Icon className={cn("w-3 h-3 shrink-0", !isFile && "text-on-surface/40")} />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className={cn("truncate tracking-tight", !isFile && "font-bold text-on-surface/80")}>
              {item.display_name}
            </span>
            {isUnresolved && (
              <span className="px-1 py-0.5 rounded-[2px] bg-warning text-white text-[8px] font-black uppercase leading-none">待确认</span>
            )}
            {isReview && (
              <span className="px-1 py-0.5 rounded-[2px] bg-primary text-white text-[8px] font-black uppercase leading-none">待核对</span>
            )}
          </div>
          {item.suggested_purpose && (
            <div className="text-[9px] text-on-surface-variant/40 leading-tight line-clamp-1 italic">
              {item.suggested_purpose}
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="opacity-0 group-hover/item:opacity-100 flex items-center gap-0.5 pr-1">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(item.item_id, item.target_relpath || ""); }}
              className="p-1 hover:bg-primary/10 rounded text-on-surface-variant/50 hover:text-primary transition-colors"
            >
              <Edit2 className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onMoveToReview(item.item_id); }}
              className="p-1 hover:bg-warning/10 rounded text-on-surface-variant/50 hover:text-warning transition-colors"
            >
              <ArrowRight className="w-2.5 h-2.5" />
            </button>
          </div>
        )}
      </div>
      {hoverDetails.length > 0 && (
        <div className="pointer-events-none absolute left-6 right-3 top-full z-20 mt-1 hidden rounded-xl border border-on-surface/10 bg-surface-container px-3 py-2 text-[11px] leading-5 text-on-surface shadow-lg group-hover/item:block">
          {hoverDetails.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
      {isEditing && (
        <div className="flex gap-2 py-1 mt-1 ml-4 border-l border-primary/20 pl-2" onClick={(e) => e.stopPropagation()}>
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
          <button onClick={() => handleEditSubmit(item.item_id)} className="text-[9px] font-black text-primary uppercase">OK</button>
        </div>
      )}
    </div>
  );
}

export function PreviewPanel({
  plan,
  stage,
  isBusy,
  readOnly = false,
  onRunPrecheck,
  onUpdateItem,
}: PreviewPanelProps) {
  const [viewMode, setViewMode] = useState<"before" | "after">("after");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (path: string) => {
    setExpandedGroups((prev) => ({ ...prev, [path]: !(prev[path] ?? true) }));
  };

  const handleEditSubmit = (itemId: string) => {
    if (!editValue.trim()) {
      setEditingId(null);
      return;
    }
    onUpdateItem(itemId, { target_dir: editValue.trim() });
    setEditingId(null);
    setEditValue("");
  };

  const afterTree = plan.groups.length > 0 ? buildFileTree(plan.groups) : buildTargetTree(plan.items);
  const beforeTree = buildSourceTree(plan.items);
  const currentTree = viewMode === "after" ? afterTree : beforeTree;
  const isViewOnly = viewMode === "before" || readOnly;
  const hasTreeContent =
    viewMode === "after"
      ? plan.groups.length > 0 || plan.items.some((item) => Boolean(item.target_relpath))
      : plan.items.length > 0;

  return (
    <div className="flex flex-col h-full bg-surface overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-on-surface uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> 当前方案
            </h2>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-container-high text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">
              {stage === "completed" ? "已完成" : "整理中"}
            </div>
          </div>

          {/* 核心指标 4 宫格 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-surface-container-lowest/40 rounded-md p-3 border border-on-surface/5 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 opacity-40">
                <ArrowRight className="w-3 h-3 text-primary" />
                <span className="text-[9px] font-bold text-on-surface uppercase tracking-wider">移动文件</span>
              </div>
              <p className="text-xl font-headline font-black text-on-surface tabular-nums leading-none">
                {plan.stats.move_count}
              </p>
            </div>
            <div className="bg-surface-container-lowest/40 rounded-md p-3 border border-on-surface/5 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 opacity-40">
                <FolderPlus className="w-3 h-3 text-emerald-500" />
                <span className="text-[9px] font-bold text-on-surface uppercase tracking-wider">新建目录</span>
              </div>
              <p className="text-xl font-headline font-black text-on-surface tabular-nums leading-none">
                {plan.stats.directory_count}
              </p>
            </div>
            <div className="bg-surface-container-lowest/40 rounded-md p-3 border border-on-surface/5 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 opacity-40">
                <AlertTriangle className="w-3 h-3 text-warning" />
                <span className="text-[9px] font-bold text-on-surface uppercase tracking-wider">待确认</span>
              </div>
              <p className={cn(
                "text-xl font-headline font-black tabular-nums leading-none",
                plan.unresolved_items.length > 0 ? "text-warning" : "text-on-surface/20"
              )}>
                {plan.unresolved_items.length}
              </p>
            </div>
            <div className="bg-surface-container-lowest/40 rounded-md p-3 border border-on-surface/5 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 opacity-40">
                <Archive className="w-3 h-3 text-on-surface-variant" />
                <span className="text-[9px] font-bold text-on-surface uppercase tracking-wider">Review</span>
              </div>
              <p className="text-xl font-headline font-black text-on-surface tabular-nums leading-none">
                {plan.review_items.length}
              </p>
            </div>
          </div>

          {/* 方案总结与亮点 */}
          {(plan.summary || (plan.change_highlights && plan.change_highlights.length > 0)) && (
            <div className="space-y-4 pt-2">
              {plan.summary && (
                <div className="p-4 bg-primary/5 rounded-md border-l-2 border-primary/20">
                  <p className="text-[13px] leading-6 text-on-surface/80 font-medium italic">
                    “ {plan.summary} ”
                  </p>
                </div>
              )}

              {plan.change_highlights && plan.change_highlights.length > 0 && (
                <div className="space-y-2.5">
                  <h4 className="text-[10px] font-black text-on-surface-variant/40 uppercase tracking-[0.2em] flex items-center gap-2">
                    <Sparkles className="w-3 h-3" /> 本轮重点变化
                  </h4>
                  <div className="grid grid-cols-1 gap-1.5">
                    {plan.change_highlights.slice(0, 5).map((highlight, idx) => (
                      <div key={idx} className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-surface-container-low/30 text-[11px] text-on-surface/70 border border-on-surface/5">
                        <Check className="w-3 h-3 text-primary/40" />
                        {highlight}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[9px] font-black text-on-surface-variant/30 flex items-center gap-1 uppercase tracking-[0.15em]">
                  <Layers className="w-3 h-3" /> 目录结构
                </h3>
              </div>

              {/* 视图切换分段选择器 */}
              <div className="flex p-0.5 bg-surface-container-low/50 rounded-md border border-on-surface/5">
                <button
                  onClick={() => setViewMode("before")}
                  className={cn(
                    "flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all rounded-[calc(0.375rem-2px)]",
                    viewMode === "before" 
                      ? "bg-surface-container-lowest text-on-surface shadow-sm" 
                      : "text-on-surface-variant/40 hover:text-on-surface-variant/60"
                  )}
                >
                  整理前
                </button>
                <button
                  onClick={() => setViewMode("after")}
                  className={cn(
                    "flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all rounded-[calc(0.375rem-2px)]",
                    viewMode === "after" 
                      ? "bg-surface-container-lowest text-on-surface shadow-sm" 
                      : "text-on-surface-variant/40 hover:text-on-surface-variant/60"
                  )}
                >
                  整理后
                </button>
              </div>
            </div>

            <div className="bg-surface-container-lowest/40 rounded-md p-2 border border-on-surface/5 min-h-[150px]">
              {!hasTreeContent ? (
                <div className="flex flex-col items-center justify-center h-40 text-[10px] font-bold text-on-surface-variant/10 italic gap-2">
                  <Archive className="w-6 h-6 opacity-5" />
                  还没有可显示的内容
                </div>
              ) : (
                <FolderNode
                  node={currentTree}
                  level={0}
                  readOnly={isViewOnly}
                  editingId={editingId}
                  editValue={editValue}
                  expandedGroups={expandedGroups}
                  onToggle={toggleGroup}
                  onEdit={(id, path) => {
                    setEditingId(id);
                    setEditValue(path.split("/").slice(0, -1).join("/") || "");
                  }}
                  onMoveToReview={(id) => onUpdateItem(id, { move_to_review: true })}
                  onUpdateItem={onUpdateItem}
                  setEditingId={setEditingId}
                  setEditValue={setEditValue}
                  handleEditSubmit={handleEditSubmit}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {!readOnly && (
        <div className="shrink-0 p-8 bg-surface-container-lowest/60 backdrop-blur-xl border-t border-on-surface/5">
          {/* 决策引导说明 */}
          <div className="mb-4 flex items-start gap-2.5 px-1">
            {plan.unresolved_items.length > 0 ? (
              <div className="flex items-center gap-2 text-[11px] font-bold text-warning leading-relaxed">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>仍有 {plan.unresolved_items.length} 项冲突待处理，请先在左侧对话区完成确认</span>
              </div>
            ) : plan.readiness.can_precheck || plan.items.length > 0 ? (
              <div className="flex items-center gap-2 text-[11px] font-bold text-primary leading-relaxed">
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>方案已经准备好了，如果你满意，可以直接开始预检。</span>
              </div>
            ) : null}
          </div>

          <button
            onClick={onRunPrecheck}
            disabled={isBusy || (!plan.readiness.can_precheck && plan.unresolved_items.length > 0)}
            className={cn(
              "w-full flex items-center justify-center gap-3 py-4 rounded-md text-[11px] font-headline font-black uppercase tracking-[0.25em] transition-all",
              (plan.readiness.can_precheck || plan.unresolved_items.length === 0) && !isBusy
                ? "bg-linear-to-b from-primary to-primary-dim text-white shadow-[0_8px_30px_rgb(76,98,88,0.15)] hover:shadow-[0_12px_40px_rgb(76,98,88,0.25)] active:scale-[0.98] cursor-pointer" 
                : "bg-surface-container-highest text-on-surface-variant/30 cursor-not-allowed grayscale-[0.5] opacity-50"
            )}
          >
            {isBusy ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Activity className="w-4 h-4 ml-1 opacity-60" />
            )}
            {isBusy ? "正在更新中" : "开始预检"}
          </button>
          
          <p className="mt-4 text-[9px] text-center font-bold text-on-surface-variant/30 uppercase tracking-[0.2em]">
            预检只检查真实文件冲突与目录写入权限，不会立刻执行移动
          </p>
        </div>
      )}
    </div>
  );
}

interface PreviewPanelProps {
  plan: PlanSnapshot;
  stage: SessionStage;
  isBusy: boolean;
  readOnly?: boolean;
  onRunPrecheck: () => void;
  onUpdateItem: (itemId: string, payload: { target_dir?: string; move_to_review?: boolean }) => void;
}
