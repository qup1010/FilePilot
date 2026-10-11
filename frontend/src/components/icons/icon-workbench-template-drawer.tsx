"use client";

import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FileText, Palette, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { IconTemplate } from "@/types/icon-workbench";
import { getIconTemplateDisplayDescription, getIconTemplateDisplayName } from "./icon-workbench-utils";

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
  const { t } = useTranslation("common");
  const supportedPlaceholders = [
    { label: t("iconWorkbench.templateDrawer.placeholderSubject"), value: "{{subject}}" },
    { label: t("iconWorkbench.templateDrawer.placeholderFolderName"), value: "{{folder_name}}" },
    { label: t("iconWorkbench.templateDrawer.placeholderCategory"), value: "{{category}}" },
  ];

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/20 backdrop-blur-[2px] transition-opacity duration-200 ease-out starting:opacity-0" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-[75] flex h-full w-full max-w-[1120px] flex-col border-l-2 border-on-surface/12 bg-surface-container-lowest outline-none transition-transform duration-300 ease-out starting:translate-x-full">
            <div className="flex items-center justify-between border-b border-on-surface/6 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
                  <Palette className="h-5 w-5" />
                </div>
                <div>
                  <DialogPrimitive.Title asChild>
                    <h2 className="text-[18px] font-black tracking-tight text-on-surface">{t("iconWorkbench.templateDrawer.title")}</h2>
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description asChild>
                    <p className="text-[12px] text-ui-muted">{t("iconWorkbench.templateDrawer.description")}</p>
                  </DialogPrimitive.Description>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ui-muted transition-colors hover:bg-on-surface/4"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 md:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="flex min-h-0 flex-col border-b border-on-surface/6 bg-surface-container-low/46 md:border-b-0 md:border-r">
                <div className="flex items-center justify-between border-b border-on-surface/6 px-4 py-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ui-muted">{t("iconWorkbench.templateDrawer.index")}</p>
                    <p className="mt-1 text-[12px] text-ui-muted">{t("iconWorkbench.templateDrawer.available", { count: templates.length })}</p>
                  </div>
                  <button
                    onClick={onReloadTemplates}
                    className="text-primary transition-opacity hover:opacity-70"
                    title={t("iconWorkbench.templateDrawer.refresh")}
                  >
                    <RefreshCw className={cn("h-4 w-4", templatesLoading && "animate-spin")} />
                  </button>
                </div>

                <div className="max-h-[38vh] flex-1 overflow-y-auto px-3 py-3 scrollbar-thin md:max-h-none">
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
                              : "border-transparent bg-transparent hover:border-on-surface/8 hover:bg-surface-container-lowest",
                          )}
                        >
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-on-surface/6 bg-surface-container-lowest">
                            {template.cover_image ? (
                              <img src={template.cover_image} alt={getIconTemplateDisplayName(template, t)} className="h-full w-full object-cover" />
                            ) : (
                              <Palette className="h-4 w-4 text-primary/35" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-[13px] font-bold text-on-surface">{getIconTemplateDisplayName(template, t)}</p>
                              <span className={cn(
                                "rounded-full px-2 py-0.5 text-[11px] font-bold tracking-[0.14em]",
                                template.is_builtin ? "bg-on-surface/6 text-ui-muted" : "bg-primary/10 text-primary",
                              )}>
                                {template.is_builtin ? t("iconWorkbench.templateDrawer.system") : t("iconWorkbench.templateDrawer.custom")}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-ui-muted">
                              {getIconTemplateDisplayDescription(template, t) || t("iconWorkbench.templateDrawer.fallbackDescription")}
                            </p>
                          </div>
                        </button>
                      );
                    })}

                    <button
                      onClick={() => onSelectTemplate("")}
                      className="flex items-center gap-3 rounded-[12px] border border-dashed border-primary/18 bg-surface-container-lowest px-3 py-3 text-left text-primary transition-colors hover:bg-primary/5"
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-primary/8">
                        <Plus className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[13px] font-bold">{t("iconWorkbench.templateDrawer.create")}</p>
                        <p className="mt-1 text-[11px] leading-5 text-primary/70">{t("iconWorkbench.templateDrawer.createDescription")}</p>
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
                      {t(selectedTemplate ? "iconWorkbench.templateDrawer.edit" : "iconWorkbench.templateDrawer.createHeading")}
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] leading-6 text-ui-muted">
                    {t("iconWorkbench.templateDrawer.promptGuide", { subjectToken: "{{subject}}" })}
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-5 scrollbar-thin sm:px-6">
                  <div className="mx-auto flex max-w-[680px] flex-col gap-5">
                    <div className="space-y-1.5">
                      <label className="pl-1 text-[12px] font-bold uppercase tracking-[0.14em] text-ui-muted">{t("iconWorkbench.templateDrawer.name")}</label>
                      <input
                        value={selectedTemplate?.is_builtin ? getIconTemplateDisplayName(selectedTemplate, t) : templateNameDraft}
                        readOnly={selectedTemplate?.is_builtin}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onTemplateNameChange(e.target.value)}
                        placeholder={t("iconWorkbench.templateDrawer.namePlaceholder")}
                        className="h-11 w-full rounded-[8px] border border-on-surface/10 bg-surface-container-lowest px-4 text-[14px] outline-none transition-all focus:border-primary/20 focus:ring-4 focus:ring-primary/4"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="pl-1 text-[12px] font-bold uppercase tracking-[0.14em] text-ui-muted">{t("iconWorkbench.templateDrawer.descriptionLabel")}</label>
                      <textarea
                        value={selectedTemplate?.is_builtin ? getIconTemplateDisplayDescription(selectedTemplate, t) : templateDescriptionDraft}
                        readOnly={selectedTemplate?.is_builtin}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onTemplateDescriptionChange(e.target.value)}
                        placeholder={t("iconWorkbench.templateDrawer.descriptionPlaceholder")}
                        rows={3}
                        className="w-full resize-none rounded-[8px] border border-on-surface/10 bg-surface-container-lowest px-4 py-3 text-[14px] outline-none transition-all focus:border-primary/20 focus:ring-4 focus:ring-primary/4"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="pl-1 text-[12px] font-bold uppercase tracking-[0.14em] text-ui-muted">{t("iconWorkbench.templateDrawer.prompt")}</label>
                      <textarea
                        value={templatePromptDraft}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onTemplatePromptChange(e.target.value)}
                        placeholder="{{subject}}, minimalist 2D flat vector icon, clean geometric shapes, bold contours, high contrast"
                        rows={10}
                        className="w-full resize-none rounded-[8px] border border-on-surface/10 bg-surface-container-lowest px-4 py-3 font-mono text-[13px] leading-6 outline-none transition-all focus:border-primary/20 focus:ring-4 focus:ring-primary/4"
                      />
                      <div className="flex flex-wrap gap-2 pt-1">
                        {supportedPlaceholders.map((placeholder) => (
                          <button
                            key={placeholder.value}
                            type="button"
                            onClick={() => onTemplatePromptChange(`${templatePromptDraft}${templatePromptDraft ? "\n" : ""}${placeholder.value}`)}
                            className="rounded-full border border-primary/16 bg-primary/6 px-3 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-primary/12"
                          >
                            {t("iconWorkbench.templateDrawer.insert", { label: placeholder.label })}
                          </button>
                        ))}
                      </div>
                      <div className="space-y-1.5 pt-1 text-[11px] leading-5 text-ui-muted">
                        <p>
                          {t("iconWorkbench.templateDrawer.recommended")}{" "}
                          <code className="rounded bg-on-surface/6 px-1 py-0.5 font-mono">
                            {"{{subject}}, minimalist 2D flat vector icon, clean geometric shapes"}
                          </code>
                          {t("iconWorkbench.templateDrawer.promptSubjectHelp", { subjectToken: "{{subject}}" })}
                        </p>
                        <p>
                          <code className="rounded bg-on-surface/6 px-1 py-0.5 font-mono">{"{{folder_name}}"}</code>、
                          <code className="rounded bg-on-surface/6 px-1 py-0.5 font-mono">{"{{category}}"}</code>{" "}
                          {t("iconWorkbench.templateDrawer.optionalPlaceholderHelp")}
                        </p>
                      </div>
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
                        {t("iconWorkbench.templateDrawer.delete")}
                      </Button>
                    ) : (
                      <p className="text-[11px] leading-5 text-ui-muted">
                        {t(selectedTemplate?.is_builtin ? "iconWorkbench.templateDrawer.builtInHelp" : "iconWorkbench.templateDrawer.saveHelp")}
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
                    {t(selectedTemplate ? "iconWorkbench.templateDrawer.saveChanges" : "iconWorkbench.templateDrawer.createButton")}
                  </Button>
                </div>
              </section>
            </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
