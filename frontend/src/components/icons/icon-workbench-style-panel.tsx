"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Search, X, Check, Palette, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IconTemplate } from "@/types/icon-workbench";

interface IconWorkbenchStylePanelProps {
  isOpen: boolean;
  onClose: () => void;
  templates: IconTemplate[];
  onSelect: (id: string) => void;
  selectedTemplateId: string;
  bgApiToken: string;
  onBgApiTokenChange: (token: string) => void;
}

/**
 * 全屏风格选择面板
 * 提供沉浸式的模板预览和选择体验。
 */
export function IconWorkbenchStylePanel({
  isOpen,
  onClose,
  templates,
  onSelect,
  selectedTemplateId,
  bgApiToken,
  onBgApiTokenChange,
}: IconWorkbenchStylePanelProps) {
  const [query, setQuery] = useState("");

  const filteredTemplates = useMemo(() => {
    if (!query.trim()) return templates;
    const lowerQuery = query.toLowerCase();
    return templates.filter(
      (t: IconTemplate) =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.description?.toLowerCase().includes(lowerQuery),
    );
  }, [templates, query]);

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-surface animate-fadeIn">
      {/* 顶部标题栏 */}
      <div className="glass-surface flex items-center justify-between border-b border-on-surface/8 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-primary/12 bg-primary/10 text-primary">
            <Palette className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[18px] font-black tracking-tight text-on-surface">选择图标风格</h2>
            <p className="text-[12px] text-ui-subtle text-pretty">生成前需要先选择一个风格。点击任意模板后，会立即把它作为当前目标集合的生成风格。</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-[12px] hover:bg-on-surface/4 text-ui-muted transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="border-b border-on-surface/6 bg-surface-container-low/40 px-6 py-4">
        <div className="mx-auto max-w-[600px] space-y-3">
          <div className="ui-panel-muted border-primary/12 bg-primary/5 px-4 py-3 text-[12px] leading-6 text-primary/90">
            选择完成后面板会自动关闭，你可以直接回到工作台，为当前目标文件夹继续生成图标。
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-muted" />
              <input
                autoFocus
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                placeholder="搜索风格名称或描述..."
                className="w-full h-11 rounded-[12px] border border-on-surface/10 bg-white py-0 pl-12 pr-4 text-[14px] outline-none transition-all focus:border-primary/20 focus:ring-4 focus:ring-primary/4"
              />
            </div>
            <div className="relative flex items-center min-w-[280px]">
              <input
                type="password"
                value={bgApiToken}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onBgApiTokenChange(e.target.value)}
                placeholder="HF Token (用于极速抠图, 选填)"
                className="w-full h-11 rounded-[12px] border border-on-surface/10 bg-surface-container-lowest py-0 px-4 text-[13px] outline-none transition-all focus:border-primary/20 focus:bg-white focus:ring-4 focus:ring-primary/4 placeholder:text-12px"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 列表区 */}
      <div className="flex-1 overflow-y-auto px-6 py-8 scrollbar-thin">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredTemplates.map((template: IconTemplate) => {
            const isSelected = template.template_id === selectedTemplateId;
            return (
              <button
                key={template.template_id}
                onClick={() => {
                  onSelect(template.template_id);
                  onClose();
                }}
                className={cn(
                  "group relative flex flex-col rounded-[14px] border p-4 text-left transition-all duration-300 active:scale-[0.98]",
                  isSelected
                    ? "border-primary/24 bg-primary/5 shadow-[0_16px_34px_rgba(36,48,42,0.08)] ring-1 ring-primary/18"
                    : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/18 hover:bg-white hover:shadow-[0_12px_26px_rgba(36,48,42,0.06)]",
                )}
              >
                <div className="relative mb-4 aspect-square w-full overflow-hidden rounded-[12px] border border-on-surface/6 bg-surface-container-lowest">
                  {template.cover_image ? (
                    <img
                      src={template.cover_image}
                      alt={template.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-surface-container-low text-primary/40 transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                      <Palette className="h-10 w-10" />
                    </div>
                  )}
                  {isSelected && (
                    <div className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-lg ring-4 ring-white/50">
                      <Check className="h-4 w-4" />
                    </div>
                  )}
                </div>

                <div className="mt-1 flex-1">
                  <h3 className="text-[17px] font-black tracking-tight text-on-surface group-hover:text-primary transition-colors">
                  {template.name}
                </h3>
                <p className="mt-2 line-clamp-2 min-h-[40px] text-[13px] leading-6 text-ui-muted">
                  {template.description || "一个精美的图标风格模板。"}
                </p>
                </div>

                <div className="mt-6 flex w-full items-center justify-between border-t border-on-surface/4 pt-4">
                  <span className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wider",
                    template.is_builtin ? "bg-on-surface/6 text-ui-muted" : "bg-primary/10 text-primary"
                  )}>
                    {template.is_builtin ? "系统内置" : "自定义"}
                  </span>
                  <span className="text-[11px] font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    点击选择模板
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {filteredTemplates.length === 0 && (
          <div className="flex h-[300px] flex-col items-center justify-center text-center">
             <LayoutGrid className="mb-4 h-12 w-12 text-on-surface/10" />
            <p className="text-[15px] font-bold text-on-surface">没有找到匹配的风格</p>
            <p className="mt-1 text-[13px] text-ui-muted">尝试搜索其他关键词</p>
          </div>
        )}
      </div>
    </div>
  );
}
