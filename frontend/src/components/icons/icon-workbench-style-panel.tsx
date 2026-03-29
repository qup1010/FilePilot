"use client";

import React, { useEffect } from "react";
import { X, Check, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IconTemplate } from "@/types/icon-workbench";

interface IconWorkbenchStylePanelProps {
  isOpen: boolean;
  onClose: () => void;
  templates: IconTemplate[];
  onSelect: (id: string) => void;
  onRequestManageTemplate?: (id: string) => void;
  selectedTemplateId: string;
  bgApiToken: string;
  onBgApiTokenChange: (token: string) => void;
}

/**
 * 全屏风格选择面板 - 精简版
 * 专注于展示风格卡片的沉浸式体验。
 */
export function IconWorkbenchStylePanel({
  isOpen,
  onClose,
  templates,
  onSelect,
  selectedTemplateId,
}: IconWorkbenchStylePanelProps) {
  // ESC 键自动关闭
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
      {/* 顶部精简导航栏 */}
      <div className="glass-surface flex items-center justify-between border-b border-on-surface/8 px-6 py-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
            <Palette className="h-5.5 w-5.5" />
          </div>
          <div>
            <h2 className="text-[18px] font-black tracking-tight text-on-surface leading-tight">选择图标风格</h2>
            <p className="text-[12px] font-medium text-ui-muted">点击任意模板即可直接应用</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-[8px] hover:bg-on-surface/5 text-ui-muted transition-colors"
        >
          <X className="h-5.5 w-5.5" />
        </button>
      </div>

      {/* 全量风格展示列表区 */}
      <div className="flex-1 overflow-y-auto px-6 py-8 scrollbar-thin">
        <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {templates.map((template: IconTemplate) => {
            const isSelected = template.template_id === selectedTemplateId;
            return (
              <button
                key={template.template_id}
                onClick={() => {
                  onSelect(template.template_id);
                  onClose();
                }}
                className={cn(
                  "group relative flex flex-col rounded-[12px] border p-4 text-left transition-all duration-300 active:scale-[0.98]",
                  isSelected
                    ? "border-primary/30 bg-primary/5 shadow-xl ring-1 ring-primary/20"
                    : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/20 hover:bg-white hover:shadow-lg",
                )}
              >
                {/* 封面预览 */}
                <div className="relative mb-4 aspect-square w-full overflow-hidden rounded-[8px] border border-on-surface/6 bg-surface-container-low">
                  {template.cover_image ? (
                    <img
                      src={template.cover_image}
                      alt={template.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-primary/30">
                      <Palette className="h-12 w-12" />
                    </div>
                  )}
                  
                  {/* 选中角标 */}
                  {isSelected && (
                    <div className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-lg ring-4 ring-white">
                      <Check className="h-4.5 w-4.5 stroke-[3]" />
                    </div>
                  )}
                </div>

                {/* 文本信息 */}
                <div className="flex-1 space-y-2">
                  <h3 className="text-[17px] font-black tracking-tight text-on-surface group-hover:text-primary transition-colors">
                    {template.name}
                  </h3>
                  <p className="line-clamp-2 text-[13px] leading-relaxed text-ui-muted italic">
                    {template.description || "为文件夹注入灵魂的艺术风格..."}
                  </p>
                </div>

                {/* 底部标记 */}
                <div className="mt-5 flex w-full items-center justify-between border-t border-on-surface/4 pt-4">
                  <span className={cn(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider",
                    template.is_builtin ? "bg-on-surface/6 text-ui-muted" : "bg-primary/10 text-primary"
                  )}>
                    {template.is_builtin ? "BUILT-IN" : "CUSTOM"}
                  </span>
                  <span className="text-[11px] font-black text-primary opacity-0 transition-all translate-x-1 group-hover:opacity-100 group-hover:translate-x-0">
                    USE STYLE →
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
