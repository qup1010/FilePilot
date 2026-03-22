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
} from "lucide-react";
import { PlanSnapshot, SessionStage, PlanItem } from "@/types/session";
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

interface PreviewPanelProps {
  plan: PlanSnapshot;
  stage: SessionStage;
  isBusy: boolean;
  onRunPrecheck: () => void;
  onUpdateItem: (itemId: string, payload: { target_dir?: string; move_to_review?: boolean }) => void;
  onPromptConflict: (itemText: string) => void;
}

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

export function PreviewPanel({
  plan,
  stage,
  isBusy,
  onRunPrecheck,
  onUpdateItem,
  onPromptConflict,
}: PreviewPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (dir: string) => {
    setExpandedGroups((prev) => ({ ...prev, [dir]: !prev[dir] }));
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

  return (
    <div className="flex flex-col h-full bg-surface overflow-hidden">
      <div className="flex-1 overflow-y-auto p-10 space-y-10 scrollbar-thin">
        <div className="space-y-8">
          <div className="flex items-center justify-between h-12">
            <h2 className="text-sm font-bold font-headline text-on-surface tracking-widest uppercase">建议目录树</h2>
            {plan.unresolved_items.length > 0 ? (
              <div className="px-3 py-1 bg-warning-container/30 text-warning rounded text-[9px] font-black tracking-widest uppercase border border-warning/10">
                存在冲突
              </div>
            ) : stage === "ready_to_execute" ? (
              <div className="px-3 py-1 bg-emerald-500 text-white rounded text-[11px] font-black shadow-sm">
                已通过预检
              </div>
            ) : (
              <div className="px-3 py-1 bg-surface-container-highest text-on-surface-variant/60 rounded text-[11px] font-black">
                草案生成中
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-surface-container-low p-5 rounded-md border border-on-surface/5 flex flex-col gap-2">
              <div className="flex items-center gap-2 opacity-40">
                <Archive className="w-3.5 h-3.5 text-on-surface" />
                <span className="text-[11px] font-bold text-on-surface">预测目录数</span>
              </div>
              <p className="text-2xl font-black text-on-surface tabular-nums leading-none tracking-tight">
                {plan.stats.directory_count}
              </p>
            </div>
            <div className="bg-surface-container-low p-5 rounded-md border border-on-surface/5 flex flex-col gap-2">
              <div className="flex items-center gap-2 mb-2 opacity-40">
                <Activity className="w-3.5 h-3.5 text-on-surface" />
                <span className="text-[11px] font-bold text-on-surface">待执行操作</span>
              </div>
              <p className="text-2xl font-black text-on-surface tabular-nums leading-none tracking-tight">
                {plan.stats.move_count}
              </p>
            </div>
          </div>

          <AnimatePresence>
            {plan.unresolved_items.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="p-6 bg-warning-container/10 border border-warning/20 rounded-md space-y-4 overflow-hidden shadow-sm"
              >
                <h3 className="text-xs font-black text-warning flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> 架构冲突待决
                </h3>
                <div className="space-y-2">
                  {plan.unresolved_items.map((item, idx) => {
                    const matchedItem = findPlanItemForConflict(plan, item);
                    return (
                      <motion.div
                        key={`${item}-${idx}`}
                        className="bg-white border border-warning/10 p-4 rounded-md hover:border-warning/40 transition-all group flex items-start gap-4 shadow-xs"
                        whileHover={{ x: 4 }}
                      >
                        <div className="mt-1 w-1 h-4 bg-warning/20 group-hover:bg-warning transition-colors" />
                        <div className="flex-1">
                          <p className="text-[12.5px] font-bold text-on-surface leading-normal">{item}</p>
                          <p className="mt-2 text-[10px] text-on-surface-variant leading-relaxed">
                            点击这里不再默认等同于“已解决”。你可以继续向 AI 澄清，或者直接把它移到 Review。
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => onPromptConflict(item)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-warning/20 px-3 py-2 text-[11px] font-black text-warning transition-colors hover:bg-warning/10"
                            >
                              继续向 AI 澄清
                              <ChevronRight className="w-3 h-3" />
                            </button>
                            {matchedItem ? (
                              <button
                                type="button"
                                onClick={() => onUpdateItem(matchedItem.item_id, { move_to_review: true })}
                                className="inline-flex items-center gap-1.5 rounded-md border border-on-surface/10 px-3 py-2 text-[11px] font-black text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
                              >
                                直接移到 Review
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-6">
            <div className="flex items-center justify-between opacity-40">
              <h3 className="text-xs font-black text-on-surface-variant/70 flex items-center gap-2">
                <Layers className="w-4 h-4" /> 架构层级预览
              </h3>
              <button
                onClick={onRunPrecheck}
                disabled={isBusy}
                className="hover:text-primary transition-colors disabled:opacity-30"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isBusy && "animate-spin")} />
              </button>
            </div>

            <div className="space-y-1">
              {plan.groups.length === 0 ? (
                <div className="p-16 border border-dashed border-on-surface/5 rounded-md text-center text-xs font-bold text-on-surface-variant/40 italic">
                  等待生成目录映射...
                </div>
              ) : (
                plan.groups.map((group, gIdx) => (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: gIdx * 0.02 }}
                    key={group.directory}
                    className="group/row bg-white hover:bg-surface-container-low/30 transition-all border-b border-on-surface/5 py-6 px-4 first:rounded-t-md last:rounded-b-md last:border-b-0"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <div className="w-8 h-8 rounded bg-surface-container-low flex items-center justify-center text-on-surface/30 group-hover/row:text-primary transition-colors">
                          <Folder className="w-4 h-4 shadow-xs" />
                        </div>
                        <span className="text-[13px] font-bold text-on-surface tracking-tight leading-none">
                          {group.directory}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-on-surface-variant/50 tabular-nums">
                        {group.items.length} 项
                      </span>
                    </div>

                    <div className="pl-12 grid grid-cols-1 gap-2">
                      {(expandedGroups[group.directory] ? group.items : group.items.slice(0, 8)).map((item) => {
                        const Icon = getFileIcon(item.display_name);
                        const isEditing = editingId === item.item_id;
                        return (
                          <div key={item.item_id} className="flex flex-col gap-1 group/item">
                            <div className="flex items-center gap-3 py-1 text-[12px] text-on-surface-variant hover:text-on-surface transition-colors">
                              <Icon className="w-3.5 h-3.5 opacity-30 group-hover/item:opacity-80 transition-opacity" />
                              <span className="truncate flex-1 tracking-tight pr-4">{item.display_name}</span>

                              <div className="opacity-0 group-hover/item:opacity-100 flex items-center gap-2 transition-opacity">
                                <button
                                  onClick={() => {
                                    setEditingId(item.item_id);
                                    setEditValue(item.target_relpath?.split("/").slice(0, -1).join("/") || "");
                                  }}
                                  className="p-1.5 hover:bg-primary/10 rounded transition-colors text-on-surface-variant hover:text-primary"
                                  title="重新分组"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => onUpdateItem(item.item_id, { move_to_review: true })}
                                  className="p-1.5 hover:bg-warning/10 rounded transition-colors text-on-surface-variant hover:text-warning"
                                  title="移至人工核对"
                                >
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              </div>
                            </div>

                            {isEditing ? (
                              <div className="flex gap-2 mt-1 px-1">
                                <input
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleEditSubmit(item.item_id);
                                    if (e.key === "Escape") setEditingId(null);
                                  }}
                                  className="flex-1 bg-white border-b border-primary text-[11px] py-1 outline-none font-mono"
                                  placeholder="目标目录 (如: Photos/Vacation)"
                                />
                                <button
                                  onClick={() => handleEditSubmit(item.item_id)}
                                  className="text-[10px] font-bold text-primary uppercase"
                                >
                                  保存
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="text-[10px] font-bold text-on-surface-variant uppercase"
                                >
                                  取消
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      {group.items.length > 8 && (
                        <button
                          onClick={() => toggleGroup(group.directory)}
                          className="w-fit text-[11px] text-primary font-black pl-0 pt-2 pb-2 italic hover:underline flex items-center gap-1 transition-all"
                        >
                          {expandedGroups[group.directory]
                            ? "收起部分列表"
                            : `查看全部 ${group.items.length} 个文件项`}
                          <ChevronRight
                            className={cn(
                              "w-3 h-3 transition-transform",
                              expandedGroups[group.directory] ? "-rotate-90" : "rotate-90",
                            )}
                          />
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
