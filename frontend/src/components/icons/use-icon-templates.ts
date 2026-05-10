"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { createIconWorkbenchApiClient } from "@/lib/icon-workbench-api";
import type { IconTemplate } from "@/types/icon-workbench";

interface UseIconTemplatesOptions {
  iconApi: ReturnType<typeof createIconWorkbenchApiClient>;
  setError: Dispatch<SetStateAction<string | null>>;
  showNotice: (message: string | null, detail?: string | null) => void;
}

export function useIconTemplates({
  iconApi,
  setError,
  showNotice,
}: UseIconTemplatesOptions) {
  const [templates, setTemplates] = useState<IconTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesInitialized, setTemplatesInitialized] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateActionLoading, setTemplateActionLoading] = useState(false);
  const [templateNameDraft, setTemplateNameDraft] = useState("");
  const [templateDescriptionDraft, setTemplateDescriptionDraft] = useState("");
  const [templatePromptDraft, setTemplatePromptDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    setTemplatesLoading(true);
    iconApi.listTemplates()
      .then((items) => {
        if (!cancelled) {
          setTemplates(items);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载模板失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTemplatesLoading(false);
          setTemplatesInitialized(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [iconApi, setError]);

  useEffect(() => {
    const current = templates.find((template) => template.template_id === selectedTemplateId);
    if (current) {
      setTemplateNameDraft(current.name);
      setTemplateDescriptionDraft(current.description || "");
      setTemplatePromptDraft(current.prompt_template);
      return;
    }
    setTemplateNameDraft("");
    setTemplateDescriptionDraft("");
    setTemplatePromptDraft("");
  }, [selectedTemplateId, templates]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.template_id === selectedTemplateId) || null,
    [selectedTemplateId, templates],
  );

  const reloadTemplates = useCallback(async (preferredId?: string) => {
    setTemplatesLoading(true);
    try {
      const items = await iconApi.listTemplates();
      setTemplates(items);
      const nextSelectedId = preferredId
        ? (items.some((template) => template.template_id === preferredId) ? preferredId : "")
        : (selectedTemplateId && items.some((template) => template.template_id === selectedTemplateId) ? selectedTemplateId : "");
      setSelectedTemplateId(nextSelectedId);
    } catch {
      setError("刷新模板失败");
    } finally {
      setTemplatesLoading(false);
    }
  }, [iconApi, selectedTemplateId, setError]);

  const createTemplate = useCallback(async () => {
    if (!templateNameDraft.trim() || !templatePromptDraft.trim()) {
      setError("名称和提示词不能为空");
      return;
    }
    setTemplateActionLoading(true);
    try {
      const created = await iconApi.createTemplate({
        name: templateNameDraft.trim(),
        description: templateDescriptionDraft.trim(),
        prompt_template: templatePromptDraft.trim(),
      });
      await reloadTemplates(created.template_id);
      showNotice("模板创建成功");
    } catch {
      setError("创建模板失败");
    } finally {
      setTemplateActionLoading(false);
    }
  }, [
    iconApi,
    reloadTemplates,
    setError,
    showNotice,
    templateDescriptionDraft,
    templateNameDraft,
    templatePromptDraft,
  ]);

  const updateTemplate = useCallback(async () => {
    if (!selectedTemplate || selectedTemplate.is_builtin) {
      return;
    }
    setTemplateActionLoading(true);
    try {
      const updated = await iconApi.updateTemplate(selectedTemplate.template_id, {
        name: templateNameDraft.trim(),
        description: templateDescriptionDraft.trim(),
        prompt_template: templatePromptDraft.trim(),
      });
      await reloadTemplates(updated.template_id);
      showNotice("模板更新成功");
    } catch {
      setError("更新模板失败");
    } finally {
      setTemplateActionLoading(false);
    }
  }, [
    iconApi,
    reloadTemplates,
    selectedTemplate,
    setError,
    showNotice,
    templateDescriptionDraft,
    templateNameDraft,
    templatePromptDraft,
  ]);

  const deleteTemplate = useCallback(async () => {
    if (!selectedTemplate || selectedTemplate.is_builtin) {
      return;
    }
    setTemplateActionLoading(true);
    try {
      await iconApi.deleteTemplate(selectedTemplate.template_id);
      await reloadTemplates();
      showNotice("模板已删除");
    } catch {
      setError("删除模板失败");
    } finally {
      setTemplateActionLoading(false);
    }
  }, [iconApi, reloadTemplates, selectedTemplate, setError, showNotice]);

  return {
    templates,
    templatesLoading,
    templatesInitialized,
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplate,
    templateActionLoading,
    templateNameDraft,
    setTemplateNameDraft,
    templateDescriptionDraft,
    setTemplateDescriptionDraft,
    templatePromptDraft,
    setTemplatePromptDraft,
    reloadTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  };
}
