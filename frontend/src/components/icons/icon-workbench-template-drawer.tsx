"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  Plus, 
  Trash2, 
  Save, 
  RefreshCw, 
  FileText,
  Palette,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

/**
 * 模板管理抽屉
 * 允许用户创建、编辑和删除图标风格模板。
 */
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
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/20 backdrop-blur-[2px]"
          />

          {/* 抽屉层 */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 z-[75] h-full w-full max-w-[480px] border-l border-on-surface/8 bg-white shadow-[-20px_0_60px_rgba(0,0,0,0.1)] flex flex-col"
          >
            {/* 顶栏 */}
            <div className="flex items-center justify-between border-b border-on-surface/6 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Palette className="h-4.5 w-4.5" />
                </div>
                <h2 className="text-[18px] font-black tracking-tight text-on-surface">管理风格模板</h2>
              </div>
              <button 
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-on-surface/4 text-ui-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
              <div className="space-y-8">
                {/* 模板列表 */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[12px] font-bold uppercase tracking-widest text-ui-muted">现有风格</span>
                    <button 
                      onClick={onReloadTemplates}
                      className="text-primary hover:opacity-70 transition-opacity"
                      title="刷新列表"
                    >
                      <RefreshCw className={cn("h-4 w-4", templatesLoading && "animate-spin")} />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    {templates.map((t: IconTemplate) => (
                      <button
                        key={t.template_id}
                        onClick={() => onSelectTemplate(t.template_id)}
                        className={cn(
                          "relative group overflow-hidden rounded-[8px] border transition-all text-left flex flex-col",
                          t.template_id === selectedTemplate?.template_id
                            ? "border-primary/30 ring-1 ring-primary/20 shadow-md bg-primary/4"
                            : "border-on-surface/8 hover:border-primary/20 bg-white hover:shadow-sm"
                        )}
                      >
                        <div className="relative aspect-video w-full bg-surface-container-lowest overflow-hidden border-b border-on-surface/6">
                           {t.cover_image ? (
                             <img src={t.cover_image} alt={t.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                           ) : (
                             <div className="flex h-full w-full items-center justify-center text-primary/30 bg-surface-container-low">
                               <Palette className="h-5 w-5" />
                             </div>
                           )}
                           {t.template_id === selectedTemplate?.template_id && (
                             <div className="absolute inset-0 bg-primary/10" />
                           )}
                        </div>
                        <div className={cn(
                          "px-3 py-2 text-[12px] font-bold truncate w-full",
                          t.template_id === selectedTemplate?.template_id ? "text-primary" : "text-on-surface"
                        )}>
                          {t.name}
                        </div>
                      </button>
                    ))}
                    <button
                      onClick={() => onSelectTemplate("")}
                      className="flex flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-primary/20 bg-white text-primary text-[13px] font-bold hover:bg-primary/4 transition-colors min-h-[90px]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      创建新风格
                    </button>
                  </div>
                </section>

                {/* 编辑表单 */}
                <section className="space-y-5">
                  <div className="flex items-center gap-2 mb-4">
                    <FileText className="h-4 w-4 text-ui-muted" />
                    <span className="text-[12px] font-bold uppercase tracking-widest text-ui-muted">
                      {selectedTemplate ? "编辑风格" : "创建新风格"}
                    </span>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-bold text-on-surface opacity-80 pl-1">风格名称</label>
                      <input 
                        value={templateNameDraft}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onTemplateNameChange(e.target.value)}
                        placeholder="例如：3D 粘土风格"
                        className="w-full rounded-xl border border-on-surface/10 bg-surface-container-low/30 px-4 py-2.5 text-[14px] outline-none focus:border-primary/20 focus:bg-white focus:ring-4 focus:ring-primary/4"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[13px] font-bold text-on-surface opacity-80 pl-1">风格描述</label>
                      <textarea 
                        value={templateDescriptionDraft}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onTemplateDescriptionChange(e.target.value)}
                        placeholder="描述这种风格的视觉特征..."
                        rows={2}
                        className="w-full resize-none rounded-xl border border-on-surface/10 bg-surface-container-low/30 px-4 py-2.5 text-[14px] outline-none focus:border-primary/20 focus:bg-white focus:ring-4 focus:ring-primary/4"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between pl-1">
                        <label className="text-[13px] font-bold text-on-surface opacity-80">提示词模版</label>
                        <div className="group relative">
                          <Info className="h-3.5 w-3.5 text-ui-muted cursor-help" />
                          <div className="absolute bottom-full right-0 mb-2 w-48 translate-y-2 scale-0 rounded-lg bg-black p-2 text-[10px] text-white transition-opacity group-hover:scale-100 group-hover:opacity-100 opacity-0">
                            使用 &#123;visual_subject&#125; 作为文件夹内容的占位符。
                          </div>
                        </div>
                      </div>
                      <textarea 
                        value={templatePromptDraft}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onTemplatePromptChange(e.target.value)}
                        placeholder="Apple style app icon of {visual_subject}, 3d render..."
                        rows={6}
                        className="w-full resize-none rounded-xl border border-on-surface/10 bg-surface-container-low/30 px-4 py-2.5 text-[13px] leading-6 font-mono outline-none focus:border-primary/20 focus:bg-white focus:ring-4 focus:ring-primary/4"
                      />
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {/* 底部操作页脚 */}
            <div className="border-t border-on-surface/6 p-6 flex items-center justify-between gap-3 bg-surface-container-low/30">
              {Boolean(selectedTemplate && !selectedTemplate.is_builtin) ? (
                <Button 
                  variant="secondary" 
                  className="rounded-xl grow hover:bg-error/10 hover:text-error hover:border-error/20"
                  onClick={onDeleteTemplate}
                  disabled={templateActionLoading}
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </Button>
              ) : <div className="grow" />}

              <Button 
                variant="primary" 
                className="rounded-xl grow px-8 shadow-lg shadow-primary/10"
                onClick={selectedTemplate ? onUpdateTemplate : onCreateTemplate}
                disabled={templateActionLoading || (selectedTemplate?.is_builtin ?? false)}
                loading={templateActionLoading}
              >
                <Save className="h-4 w-4" />
                {selectedTemplate ? "保存更改" : "创建风格"}
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
