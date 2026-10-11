"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { createIconWorkbenchApiClient } from "@/lib/icon-workbench-api";
import { localizeUserFacingError } from "@/lib/user-facing-copy";
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
  const { t } = useTranslation("common");
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
          setError(localizeUserFacingError(err, t("iconWorkbench.errors.loadTemplates")));
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
  }, [iconApi, setError, t]);

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
      setError(t("iconWorkbench.errors.reloadTemplates"));
    } finally {
      setTemplatesLoading(false);
    }
  }, [iconApi, selectedTemplateId, setError, t]);

  const createTemplate = useCallback(async () => {
    if (!templateNameDraft.trim() || !templatePromptDraft.trim()) {
      setError(t("iconWorkbench.errors.templateFieldsRequired"));
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
      showNotice(t("iconWorkbench.notices.templateCreated"));
    } catch {
      setError(t("iconWorkbench.errors.createTemplate"));
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
    t,
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
      showNotice(t("iconWorkbench.notices.templateUpdated"));
    } catch {
      setError(t("iconWorkbench.errors.updateTemplate"));
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
    t,
  ]);

  const deleteTemplate = useCallback(async () => {
    if (!selectedTemplate || selectedTemplate.is_builtin) {
      return;
    }
    setTemplateActionLoading(true);
    try {
      await iconApi.deleteTemplate(selectedTemplate.template_id);
      await reloadTemplates();
      showNotice(t("iconWorkbench.notices.templateDeleted"));
    } catch {
      setError(t("iconWorkbench.errors.deleteTemplate"));
    } finally {
      setTemplateActionLoading(false);
    }
  }, [iconApi, reloadTemplates, selectedTemplate, setError, showNotice, t]);

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
