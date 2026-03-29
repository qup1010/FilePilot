"use client";

import React, { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FileText, Palette, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { IconTemplate } from "@/types/icon-workbench";

interface IconWorkbenchTemplateDrawerProps {
  open: boolean;
  onClose: () => void;
  templates: IconTemplate[];
  templatesLoading: boolean;
  selectedTemplate: IconTemplate | null;
  templateNameDraft: string;
  templateDescriptionDraft: string;
  templatePromptDraft: string;
  templateActionLoading: boolean;
  onSelectTemplate: (id: string) => void;
  onTemplateNameChange: (name: string) => void;
  onTemplateDescriptionChange: (desc: string) => void;
  onTemplatePromptChange: (prompt: string) => void;
  onReloadTemplates: () => void;
  onCreateTemplate: () => void;
  onUpdateTemplate: () => void;
  onDeleteTemplate: () => void;
}

export function IconWorkbenchTemplateDrawer({
  open,
  onClose,
  templates,
  templatesLoading,
  selectedTemplate,
  templateNameDraft,
  templateDescriptionDraft,
  templatePromptDraft,
  templateActionLoading,
  onSelectTemplate,
  onTemplateNameChange,
  onTemplateDescriptionChange,
  onTemplatePromptChange,
  onReloadTemplates,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
}: IconWorkbenchTemplateDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/20 backdrop-blur-[2px]"
          />

          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 26, stiffness: 220 }}
            className="fixed right-0 top-0 z-[75] flex h-full w-full max-w-[1040px] flex-col border-l border-on-surface/8 bg-surface-container-lowest shadow-[-20px_0_60px_rgba(0,0,0,0.1)]"
          >
            <div className="flex items-center justify-between border-b border-on-surface/6 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                  <Palette className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-[18px] font-black tracking-tight text-on-surface">模板管理</h2>
                  <p className="text-[12px] text-ui-muted">这里用于维护风格模板本身，不承担主工作面的浏览任务。</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-[10px] text-ui-muted transition-colors hover:bg-on-surface/4"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="flex min-h-0 flex-col border-b border-on-surface/6 bg-surface-container-low/46 lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between border-b border-on-surface/6 px-4 py-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ui-muted">模板索引</p>
                    <p className="mt-1 text-[12px] text-ui-muted">{templates.length} 个可用模板</p>
                  </div>
                  <button
                    onClick={onReloadTemplates}
                    className="text-primary transition-opacity hover:opacity-70"
                    title="刷新列表"
                  >
                    <RefreshCw className={cn("h-4 w-4", templatesLoading && "animate-spin")} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-3 scrollbar-thin">
                  <div className="flex flex-col gap-2">
                    {templates.map((template: IconTemplate) => {
                      const isSelected = template.template_id === selectedTemplate?.template_id;
                      return (
                        <button
                          key={template.template_id}
                          onClick={() => onSelectTemplate(template.template_id)}
                          className={cn(
                            "flex items-center gap-3 rounded-[12px] border px-3 py-3 text-left transition-colors",
                            isSelected
                              ? "border-primary/18 bg-primary/5"
                              : "border-transparent bg-transparent hover:border-on-surface/8 hover:bg-white",
                          )}
                        >
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-on-surface/6 bg-white">
                            {template.cover_image ? (
                              <img src={template.cover_image} alt={template.name} className="h-full w-full object-cover" />
                            ) : (
                              <Palette className="h-4 w-4 text-primary/35" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-[13px] font-bold text-on-surface">{template.name}</p>
                              <span className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.14em]",
                                template.is_builtin ? "bg-on-surface/6 text-ui-muted" : "bg-primary/10 text-primary",
                              )}>
                                {template.is_builtin ? "系统" : "自定义"}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-ui-muted">
                              {template.description || "为目标集合提供统一的图标风格。"}
                            </p>
                          </div>
                        </button>
                      );
                    })}

                    <button
                      onClick={() => onSelectTemplate("")}
                      className="flex items-center gap-3 rounded-[12px] border border-dashed border-primary/18 bg-white px-3 py-3 text-left text-primary transition-colors hover:bg-primary/5"
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-primary/8">
                        <Plus className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[13px] font-bold">创建新模板</p>
                        <p className="mt-1 text-[11px] leading-5 text-primary/70">新建一套自定义风格与 Prompt 模板。</p>
                      </div>
                    </button>
                  </div>
                </div>
              </aside>

              <section className="flex min-h-0 flex-col">
                <div className="border-b border-on-surface/6 px-5 py-4 sm:px-6">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-ui-muted" />
                    <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-ui-muted">
                      {selectedTemplate ? "编辑模板" : "创建模板"}
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] leading-6 text-ui-muted">
                    这里只保留名称、说明和 Prompt 三个核心字段，帮助你快速维护模板本身。
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-5 scrollbar-thin sm:px-6">
                  <div className="mx-auto flex max-w-[620px] flex-col gap-5">
                    <div className="space-y-1.5">
                      <label className="pl-1 text-[12px] font-bold uppercase tracking-[0.14em] text-ui-muted">风格名称</label>
                      <input
                        value={templateNameDraft}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onTemplateNameChange(e.target.value)}
                        placeholder="例如：3D 粘土风格"
                        className="h-11 w-full rounded-[10px] border border-on-surface/10 bg-white px-4 text-[14px] outline-none transition-all focus:border-primary/20 focus:ring-4 focus:ring-primary/4"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="pl-1 text-[12px] font-bold uppercase tracking-[0.14em] text-ui-muted">风格描述</label>
                      <textarea
                        value={templateDescriptionDraft}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onTemplateDescriptionChange(e.target.value)}
                        placeholder="描述这种风格的视觉特征..."
                        rows={3}
                        className="w-full resize-none rounded-[10px] border border-on-surface/10 bg-white px-4 py-3 text-[14px] outline-none transition-all focus:border-primary/20 focus:ring-4 focus:ring-primary/4"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="pl-1 text-[12px] font-bold uppercase tracking-[0.14em] text-ui-muted">Prompt 模板</label>
                      <textarea
                        value={templatePromptDraft}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onTemplatePromptChange(e.target.value)}
                        placeholder="Apple style app icon of {visual_subject}, 3d render..."
                        rows={10}
                        className="w-full resize-none rounded-[10px] border border-on-surface/10 bg-white px-4 py-3 font-mono text-[13px] leading-6 outline-none transition-all focus:border-primary/20 focus:ring-4 focus:ring-primary/4"
                      />
                      <p className="text-[11px] leading-5 text-ui-muted">使用 <code>{`{visual_subject}`}</code> 作为文件夹内容主题的占位符。</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-on-surface/6 bg-surface-container-low/38 px-5 py-4 sm:px-6">
                  <div>
                    {Boolean(selectedTemplate && !selectedTemplate.is_builtin) ? (
                      <Button
                        variant="secondary"
                        className="hover:border-error/20 hover:bg-error/10 hover:text-error"
                        onClick={onDeleteTemplate}
                        disabled={templateActionLoading}
                      >
                        <Trash2 className="h-4 w-4" />
                        删除模板
                      </Button>
                    ) : (
                      <p className="text-[11px] leading-5 text-ui-muted">
                        {selectedTemplate?.is_builtin ? "系统模板可选用，但不能直接覆盖保存。" : "创建后会出现在风格选择器和模板管理列表中。"}
                      </p>
                    )}
                  </div>

                  <Button
                    variant="primary"
                    className="min-w-[150px] justify-center"
                    onClick={selectedTemplate ? onUpdateTemplate : onCreateTemplate}
                    disabled={templateActionLoading || (selectedTemplate?.is_builtin ?? false)}
                    loading={templateActionLoading}
                  >
                    <Save className="h-4 w-4" />
                    {selectedTemplate ? "保存更改" : "创建模板"}
                  </Button>
                </div>
              </section>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
