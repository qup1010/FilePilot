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

interface TreeNode {
  name: string;
  path: string;
  items: PlanItem[];
  children: Record<string, TreeNode>;
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

function buildSourceTree(items: PlanItem[]): TreeNode {
  const root: TreeNode = { name: "Root", path: "", items: [], children: {} };

  items.forEach((item) => {
    const normalizedPath = item.source_relpath.replace(/\\/g, "/").replace(/\/$/, "");
    const parts = normalizedPath.split("/").filter(Boolean);
    
    let current = root;

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

    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      current.items.push(item);
    }
  });

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
    <div className={cn("flex flex-col", level > 0 && "ml-3 border-l border-on-surface/6 pl-1.5")}>
      <div 
        className={cn(
          "group flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 transition-all",
          isExpanded ? "bg-surface-container-low/30" : "hover:bg-on-surface/2"
        )}
        onClick={() => onToggle(node.path)}
      >
        <div className="flex items-center gap-1.5 shrink-0">
          <ChevronRight 
            className={cn(
              "h-3 w-3 text-on-surface-variant/30 transition-transform duration-200",
              isExpanded && "rotate-90 text-primary/50",
              !hasContent && "opacity-0"
            )} 
          />
          <Folder className={cn("h-3.5 w-3.5 text-on-surface/25", isExpanded && "text-primary/45")} />
        </div>
        <span className={cn(
          "flex-1 truncate text-[12px] font-semibold tracking-tight text-on-surface/75",
          (node.hasUnresolved || node.hasReview) && "text-on-surface"
        )}>
          {node.name}
        </span>
        
        <div className="flex items-center gap-1 pr-1">
          {node.hasUnresolved && <span className="h-1.5 w-1.5 rounded-full bg-warning" title="包含待确认项" />}
          {node.hasReview && <span className="h-1.5 w-1.5 rounded-full bg-primary/50" title="包含待核对项" />}
        </div>
        
        <span className="text-[11px] font-medium text-on-surface-variant/45 tabular-nums">
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

              {node.items.map((item) => (
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
              ))}
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
  const Icon = getFileIcon(item.display_name);
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
        "group/item relative my-0.5 flex flex-col rounded-[8px] py-1 pr-1 transition-all",
        isUnresolved ? "bg-warning/5 hover:bg-warning/10" : isReview ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-on-surface/2"
      )}
      style={{ paddingLeft: `${level * 12 + 20}px` }}
      title={tooltipText || undefined}
    >
      <div className="flex items-center gap-2 text-[13px] text-on-surface-variant/75 transition-colors hover:text-on-surface">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate tracking-tight">
              {item.display_name}
            </span>
            {isUnresolved && (
              <span className="rounded-[5px] bg-warning px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">待确认</span>
            )}
            {isReview && (
              <span className="rounded-[5px] bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">待确认</span>
            )}
          </div>
          {item.suggested_purpose && (
            <div className="line-clamp-1 text-[12px] leading-5 text-on-surface-variant/60">
              {item.suggested_purpose}
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="flex items-center gap-0.5 pr-1 opacity-0 group-hover/item:opacity-100">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(item.item_id, item.target_relpath || ""); }}
              className="rounded p-1 text-on-surface-variant/50 transition-colors hover:bg-primary/10 hover:text-primary"
            >
              <Edit2 className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onMoveToReview(item.item_id); }}
              className="rounded p-1 text-on-surface-variant/50 transition-colors hover:bg-warning/10 hover:text-warning"
            >
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      {isEditing && (
        <div className="mt-1 ml-4 flex gap-2 border-l border-primary/20 py-1 pl-2" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleEditSubmit(item.item_id);
              if (e.key === "Escape") setEditingId(null);
            }}
            className="flex-1 border-b border-primary bg-surface-container-low py-1 text-[12px] font-mono outline-none"
          />
          <button onClick={() => handleEditSubmit(item.item_id)} className="text-[12px] font-semibold text-primary">确认</button>
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
  const hasPlanItems = plan.items.length > 0;
  const hasUnresolvedItems = plan.unresolved_items.length > 0;
  const canRunPrecheck = plan.readiness.can_precheck;
  const hasTreeContent =
    viewMode === "after"
      ? plan.groups.length > 0 || plan.items.some((item) => Boolean(item.target_relpath))
      : plan.items.length > 0;

  const precheckButtonLabel = isBusy
    ? "正在更新中"
    : canRunPrecheck
      ? "开始预检"
      : hasUnresolvedItems
        ? "先完成待确认项"
        : hasPlanItems
          ? "等待方案就绪"
          : "暂无可预检内容";

  const precheckNotice = canRunPrecheck
    ? {
        tone: "ready" as const,
        text: "方案已经准备好了，如果你满意，可以直接开始预检。",
      }
    : hasUnresolvedItems
      ? {
          tone: "warning" as const,
          text: `仍有 ${plan.unresolved_items.length} 项冲突待处理，请先在左侧对话区完成确认。`,
        }
      : hasPlanItems
        ? {
            tone: "pending" as const,
            text: "方案仍在同步中，暂时还不能开始预检。",
          }
        : {
            tone: "pending" as const,
            text: "当前还没有可预检的整理方案。",
          };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-thin">
        <div className="mx-auto max-w-[1360px] space-y-4">
          {/* 计划整合容器 */}
          <div className="flex flex-col rounded-[16px] border border-on-surface/8 bg-surface-container-lowest shadow-[0_24px_56px_-12px_rgba(0,0,0,0.06)] overflow-hidden">
            {/* Header: Title + Stats + Summary */}
            <div className="border-b border-on-surface/6 bg-surface-container-low/15 px-5 py-4">
              <div className="flex items-center justify-between gap-4 mb-3.5">
                <div className="space-y-0.5">
                  <h2 className="flex items-center gap-2 text-[15px] font-black tracking-tight text-on-surface">
                    <Activity className="h-4 w-4 text-primary" /> 当前整理方案
                  </h2>
                  <p className="text-[12px] text-ui-muted opacity-80">
                    确认目录变化范围，决定是否执行整理。
                  </p>
                </div>
                <div className="flex items-center gap-1.5 rounded-full bg-surface-container-low/60 px-2.5 py-1 text-[11px] font-bold text-on-surface-variant/70">
                  {stage === "completed" ? "任务已完成" : "正在调整方案..."}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-y-3 gap-x-6 border-t border-on-surface/[0.04] pt-3.5">
                <div className="flex items-center gap-6">
                  <div className="flex flex-col">
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-ui-muted opacity-50">移动</span>
                    <span className="text-[15px] font-black tabular-nums text-on-surface">{plan.stats.move_count}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-ui-muted opacity-50">新建</span>
                    <span className="text-[15px] font-black tabular-nums text-on-surface">{plan.stats.directory_count}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className={cn(
                      "text-[10.5px] font-bold uppercase tracking-wider",
                      plan.unresolved_items.length > 0 ? "text-warning" : "text-ui-muted opacity-50"
                    )}>待确认</span>
                    <span className={cn(
                      "text-[15px] font-black tabular-nums",
                      plan.unresolved_items.length > 0 ? "text-warning" : "text-on-surface"
                    )}>{plan.unresolved_items.length}</span>
                  </div>
                </div>

                {plan.summary && (
                  <div className="ml-auto flex items-center gap-2.5 rounded-[10px] bg-primary/[0.04] pl-3 py-1 pr-1.5 border border-primary/10">
                    <p className="text-[12px] font-black text-primary/85 leading-none">
                      {plan.summary}
                    </p>
                    <div className="h-4 w-[1px] bg-primary/15" />
                    <Sparkles className="h-3 w-3 text-primary/60" />
                  </div>
                )}
              </div>
            </div>

            {/* Tree Section */}
            <div className="flex flex-col">
              <div className="flex items-center justify-between px-5 py-3 border-b border-on-surface/[0.04]">
                <h3 className="flex items-center gap-2 text-[12px] font-bold text-on-surface/50">
                  <Layers className="h-3.5 w-3.5" /> 结构预览
                </h3>
                
                <div className="flex rounded-[9px] bg-surface-container-low p-0.5">
                  <button
                    onClick={() => setViewMode("before")}
                    className={cn(
                      "rounded-[7px] px-3 py-1 text-[11px] font-black transition-all",
                      viewMode === "before" 
                        ? "bg-white text-on-surface shadow-sm" 
                        : "text-on-surface-variant/40 hover:text-on-surface"
                    )}
                  >
                    整理前
                  </button>
                  <button
                    onClick={() => setViewMode("after")}
                    className={cn(
                      "rounded-[7px] px-3 py-1 text-[11px] font-black transition-all",
                      viewMode === "after" 
                        ? "bg-white text-on-surface shadow-sm" 
                        : "text-on-surface-variant/40 hover:text-on-surface"
                    )}
                  >
                    整理后
                  </button>
                </div>
              </div>

              <div className="min-h-[280px] max-h-[55vh] overflow-y-auto p-2 scrollbar-thin">
                {(!hasTreeContent && stage === "planning") ? (
                  <div className="flex h-64 flex-col items-center justify-center gap-4 text-center">
                    <div className="relative">
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 4, repeat: Infinity, ease: "linear" }} className="absolute -inset-2 rounded-full border-t-2 border-primary/20" />
                      <Sparkles className="h-8 w-8 text-primary/40 animate-pulse" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[14px] font-black text-on-surface">方案生成中</p>
                      <p className="text-[12px] text-ui-muted opacity-60">正在为您构建结构预览...</p>
                    </div>
                  </div>
                ) : !hasTreeContent ? (
                  <div className="flex h-36 flex-col items-center justify-center gap-2 text-[12px] font-medium text-on-surface-variant/35">
                    <Archive className="h-6 w-6 opacity-20" />
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

          {/* Highlights Feed */}
          {plan.change_highlights && plan.change_highlights.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {plan.change_highlights.slice(0, 4).map((highlight, idx) => (
                <div key={idx} className="flex items-center gap-3 rounded-[12px] border border-on-surface/5 bg-surface-container-low/30 px-3.5 py-2.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500/50" />
                  <span className="text-[12px] font-bold text-on-surface/70 leading-tight">{highlight}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="shrink-0 border-t border-on-surface/8 bg-surface-container-low px-4 py-3.5 lg:px-5">
          <div className="mb-2.5 flex items-start gap-2.5 px-1">
            <div
              className={cn(
                "flex items-center gap-2 text-[13px] font-medium leading-relaxed",
                precheckNotice.tone === "ready" && "text-primary",
                precheckNotice.tone === "warning" && "text-warning",
                precheckNotice.tone === "pending" && "text-ui-muted",
              )}
            >
              {precheckNotice.tone === "ready" ? (
                <Check className="w-3.5 h-3.5 shrink-0" />
              ) : precheckNotice.tone === "warning" ? (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 shrink-0 opacity-60" />
              )}
              <span>{precheckNotice.text}</span>
            </div>
          </div>

          <button
            onClick={onRunPrecheck}
            disabled={isBusy || !canRunPrecheck}
            className={cn(
              "flex w-full items-center justify-center gap-3 rounded-[10px] py-3.5 text-[14px] font-semibold transition-colors",
              canRunPrecheck && !isBusy
                ? "cursor-pointer border border-primary/20 bg-primary text-white hover:bg-primary-dim active:scale-[0.98]" 
                : "cursor-not-allowed border border-on-surface/8 bg-on-surface/5 text-on-surface-variant/35 opacity-60"
            )}
          >
            {isBusy ? (
              <RefreshCw className="w-4 h-4 animate-spin-slow" />
            ) : canRunPrecheck ? (
              <Layers className="w-4 h-4 opacity-70" />
            ) : hasUnresolvedItems ? (
              <AlertTriangle className="w-4 h-4" />
            ) : (
              <Archive className="w-4 h-4 opacity-70" />
            )}
            {precheckButtonLabel}
          </button>
          
          <p className="mt-2.5 text-center text-[12px] text-ui-muted">
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
