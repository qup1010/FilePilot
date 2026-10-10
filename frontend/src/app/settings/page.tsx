"use client";

import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  Cpu,
  Globe,
  ImageIcon,
  Layers3,
  RefreshCw,
  Scissors,
  Settings as SettingsIcon,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/ui/error-alert";
import { buildFamilySavePayload } from "@/app/settings/preset-flow";
import {
  buildFingerprint,
  buildSecretPayload,
  buildSettingsTabFingerprint,
  clampConcurrencyInput,
  copyTextToClipboard,
  createSecretDraft,
  createSecretDraftsFromSnapshot,
  getVisionSourceMode,
  normalizeImageSize,
  SETTINGS_TAB_IDS,
  snapshotToDraft,
  type DraftState,
  type ModelLookupState,
  type PresetConfigFamily,
  type SecretDraft,
} from "@/app/settings/settings-draft";
import {
  ConnectionTestPanel,
  SecretField,
  type ConnectionTestControls,
  type ModelLookupControls,
} from "@/app/settings/preset-form-fields";
import { BgRemovalTab } from "@/app/settings/bg-removal-tab";
import { IconImageTab } from "@/app/settings/icon-image-tab";
import { LaunchTab, type LaunchSection } from "@/app/settings/launch-tab";
import { SystemTab, type UpdateCheckResult } from "@/app/settings/system-tab";
import { TextTab } from "@/app/settings/text-tab";
import { createApiClient } from "@/lib/api";
import { notifyAppContextChange } from "@/lib/app-context-store";
import { getApiBaseUrl, getApiToken, invokeTauriCommandOrThrow, isTauriDesktop, pickDirectoryWithTauri, openUrlWithTauri } from "@/lib/runtime";
import { cn } from "@/lib/utils";
import { getUserFacingErrorCode, localizeUserFacingError } from "@/lib/user-facing-copy";
import { useUiLocale } from "@/i18n/locale-provider";
import { normalizeSavedUiLanguage } from "@/i18n/locales";
import { useTranslation } from "react-i18next";
import type {
  SettingsFamily,
  SettingsSnapshot,
  SettingsTestResult,
  SettingsUpdatePayload,
} from "@/types/settings";

type CreatePresetDialogState = {
  family: PresetConfigFamily;
  value: string;
};

type DeletePresetDialogState = {
  family: PresetConfigFamily;
  presetId: string;
  presetName: string;
};

type SwitchPresetDialogState = {
  family: PresetConfigFamily;
  presetId: string;
};

const SETTINGS_CONTEXT_KEY = "settings_header_context";
const COMPACT_SETTINGS_BREAKPOINT = 960;

export default function SettingsPage() {
  const { t } = useTranslation("common");
  const { saveUiLanguage, resolvedUiLocale } = useUiLocale();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const normalizedInitialTab =
    initialTab === "vision" || initialTab === "targets" ? (initialTab === "targets" ? "launch" : "text") : initialTab;
  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);
  const desktopReady = isTauriDesktop();
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingFamily, setTestingFamily] = useState<SettingsFamily | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<SettingsFamily, SettingsTestResult>>>({});
  const [modelLookupResults, setModelLookupResults] = useState<ModelLookupState>({});
  const [loadingModelsFamily, setLoadingModelsFamily] = useState<PresetConfigFamily | null>(null);
  const [textSecret, setTextSecret] = useState<SecretDraft>(createSecretDraft());
  const [visionSecret, setVisionSecret] = useState<SecretDraft>(createSecretDraft());
  const [iconSecret, setIconSecret] = useState<SecretDraft>(createSecretDraft());
  const [bgRemovalSecret, setBgRemovalSecret] = useState<SecretDraft>(createSecretDraft());
  const [analysisConcurrencyInput, setAnalysisConcurrencyInput] = useState("1");
  const [imageConcurrencyInput, setImageConcurrencyInput] = useState("1");
  const [baseline, setBaseline] = useState("");
  const [createPresetDialog, setCreatePresetDialog] = useState<CreatePresetDialogState | null>(null);
  const [deletePresetDialog, setDeletePresetDialog] = useState<DeletePresetDialogState | null>(null);
  const [switchPresetDialog, setSwitchPresetDialog] = useState<SwitchPresetDialogState | null>(null);
  const [activeTab, setActiveTab] = useState<string>(
    normalizedInitialTab && SETTINGS_TAB_IDS.includes(normalizedInitialTab as (typeof SETTINGS_TAB_IDS)[number]) ? normalizedInitialTab : "text",
  );
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [activeLaunchSection, setActiveLaunchSection] = useState<LaunchSection>("strategy");
  const [iconAdvancedOpen, setIconAdvancedOpen] = useState(false);

  // 关于与检查更新相关 State
  const [appVersion, setAppVersion] = useState("v1.0.4");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // 获取 Tauri 环境下的真实版本号
  useEffect(() => {
    if (isTauriDesktop()) {
      import("@tauri-apps/api/app")
        .then(({ getVersion }) => {
          getVersion()
            .then((ver) => {
              setAppVersion(`v${ver}`);
            })
            .catch((e) => {
              console.error("Failed to get Tauri app version:", e);
            });
        })
        .catch((e) => {
          console.error("Failed to import Tauri app API:", e);
        });
    }
  }, []);

  // 冷却计时器管理
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // 检查更新核心请求
  const handleCheckUpdate = useCallback(async () => {
    if (checkingUpdate || cooldown > 0) return;

    setCheckingUpdate(true);
    setUpdateResult(null);
    setUpdateError(null);
    setCooldown(10);

    try {
      const res = await fetch("https://api.github.com/repos/qup1010/FilePilot/releases/latest", {
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
      });
      if (!res.ok) {
        throw new Error(`GitHub API returned status ${res.status}`);
      }
      const data = await res.json();
      const latestVersion = data.tag_name; // 例如 "v0.1.2"

      const currentClean = appVersion.replace(/^v/, "").trim();
      const latestClean = latestVersion.replace(/^v/, "").trim();

      if (latestClean !== currentClean) {
        setUpdateResult({
          hasUpdate: true,
          version: latestVersion,
          body: data.body,
          url: data.html_url,
        });
      } else {
        setUpdateResult({
          hasUpdate: false,
          version: latestVersion,
        });
      }
    } catch (err: any) {
      console.error("Check update failed:", err);
      const status = err instanceof Error ? err.message.match(/GitHub API returned status (\d+)/)?.[1] : undefined;
      setUpdateError(
        status
          ? t("settingsPage.systemTab.updateRequestFailed", { status })
          : t("settingsPage.systemTab.updateConnectionFailed"),
      );
    } finally {
      setCheckingUpdate(false);
    }
  }, [checkingUpdate, cooldown, appVersion, t]);

  const handleOpenLink = useCallback((url: string, e: React.MouseEvent) => {
    if (isTauriDesktop()) {
      e.preventDefault();
      void openUrlWithTauri(url, t("settingsPage.errors.openLink")).catch((err) => {
        setError(localizeUserFacingError(err, t("settingsPage.errors.openLink")));
      });
    }
  }, [t]);

  const categories = useMemo(
    () => [
      { id: "text", label: t("settingsPage.categories.text.label"), icon: Layers3, description: t("settingsPage.categories.text.description") },
      { id: "launch", label: t("settingsPage.categories.launch.label"), icon: SettingsIcon, description: t("settingsPage.categories.launch.description") },
      { id: "icon_image", label: t("settingsPage.categories.iconImage.label"), icon: ImageIcon, description: t("settingsPage.categories.iconImage.description") },
      { id: "bg_removal", label: t("settingsPage.categories.bgRemoval.label"), icon: Scissors, description: t("settingsPage.categories.bgRemoval.description") },
      { id: "system", label: t("settingsPage.categories.system.label"), icon: ShieldCheck, description: t("settingsPage.categories.system.description") },
    ],
    [t],
  );

  const getPresetDisplayName = (family: "text" | "vision" | "icon_image", id: string, name: string) =>
    id === "default" ? t(`settingsPage.defaultPresets.${family}`) : name;

  const secretMap = useMemo(
    () => ({
      text: textSecret,
      vision: visionSecret,
      icon_image: iconSecret,
      bg_removal: bgRemovalSecret,
    }),
    [bgRemovalSecret, iconSecret, textSecret, visionSecret],
  );
  const activeCategory = categories.find((item) => item.id === activeTab) ?? categories[0];

  const isDirty = useMemo(
    () =>
      buildFingerprint(draft, secretMap, {
        analysisConcurrencyInput,
        imageConcurrencyInput,
      }) !== baseline,
    [analysisConcurrencyInput, baseline, draft, imageConcurrencyInput, secretMap],
  );
  const dirtyTabs = useMemo(() => {
    if (!snapshot || !draft) {
      return {} as Record<string, boolean>;
    }
    const baselineDraft = snapshotToDraft(snapshot);
    const baselineSecrets = createSecretDraftsFromSnapshot(snapshot);
    const currentInputs = {
      analysisConcurrencyInput,
      imageConcurrencyInput,
    };
    const baselineInputs = {
      analysisConcurrencyInput: String(baselineDraft.icon_image.analysis_concurrency_limit),
      imageConcurrencyInput: String(baselineDraft.icon_image.image_concurrency_limit),
    };

    return SETTINGS_TAB_IDS.reduce<Record<string, boolean>>((result, tabId) => {
      const baselineValue = buildSettingsTabFingerprint(tabId, baselineDraft, baselineSecrets, baselineInputs);
      const currentValue = buildSettingsTabFingerprint(tabId, draft, secretMap, currentInputs);
      result[tabId] = baselineValue !== currentValue;
      return result;
    }, {});
  }, [analysisConcurrencyInput, draft, imageConcurrencyInput, secretMap, snapshot]);
  const dirtyTabLabels = useMemo(
    () => categories.filter((item) => dirtyTabs[item.id]).map((item) => item.label),
    [categories, dirtyTabs],
  );
  const dirtyTabList = new Intl.ListFormat(resolvedUiLocale, { style: "long", type: "conjunction" }).format(dirtyTabLabels);
  const healthItems = useMemo(
    () => [
      {
        id: "text" as const,
        label: t("settingsPage.health.textAnalysis.label"),
        description: t("settingsPage.health.textAnalysis.description"),
        configured: Boolean(snapshot?.status.text_configured),
        optional: false,
        icon: Layers3,
      },
      {
        id: "text" as const,
        label: t("settingsPage.health.vision.label"),
        description: t("settingsPage.health.vision.description"),
        configured: Boolean(snapshot?.status.vision_configured),
        optional: true,
        icon: Globe,
      },
      {
        id: "icon_image" as const,
        label: t("settingsPage.health.iconImage.label"),
        description: t("settingsPage.health.iconImage.description"),
        configured: Boolean(snapshot?.status.icon_image_configured),
        optional: true,
        icon: ImageIcon,
      },
      {
        id: "bg_removal" as const,
        label: t("settingsPage.health.bgRemoval.label"),
        description: t("settingsPage.health.bgRemoval.description"),
        configured: Boolean(snapshot?.status.bg_removal_configured),
        optional: true,
        icon: Scissors,
      },
    ],
    [snapshot?.status.bg_removal_configured, snapshot?.status.icon_image_configured, snapshot?.status.text_configured, snapshot?.status.vision_configured, t],
  );
  const configuredHealthCount = healthItems.filter((item) => item.configured).length;

  const hydrate = (nextSnapshot: SettingsSnapshot) => {
    const nextDraft = snapshotToDraft(nextSnapshot);
    const textKey = nextSnapshot.families.text.active_preset.OPENAI_API_KEY || "";
    const visionKey = nextSnapshot.families.vision.active_preset.IMAGE_ANALYSIS_API_KEY || "";
    const iconKey = nextSnapshot.families.icon_image.active_preset.image_model.api_key || "";
    const bgKey = nextSnapshot.families.bg_removal.active_preset.hf_api_token || "";

    const currentSecrets = {
      text: createSecretDraft(textKey, nextSnapshot.families.text.active_preset.secret_state === "stored"),
      vision: createSecretDraft(visionKey, nextSnapshot.families.vision.active_preset.secret_state === "stored"),
      icon_image: createSecretDraft(iconKey, nextSnapshot.families.icon_image.active_preset.image_model.secret_state === "stored"),
      bg_removal: createSecretDraft(bgKey, nextSnapshot.families.bg_removal.active_preset.secret_state === "stored"),
    };

    setSnapshot(nextSnapshot);
    setDraft(nextDraft);
    setTextSecret(currentSecrets.text);
    setVisionSecret(currentSecrets.vision);
    setIconSecret(currentSecrets.icon_image);
    setBgRemovalSecret(currentSecrets.bg_removal);
    setAnalysisConcurrencyInput(String(nextDraft.icon_image.analysis_concurrency_limit));
    setImageConcurrencyInput(String(nextDraft.icon_image.image_concurrency_limit));
    setBaseline(
      buildFingerprint(nextDraft, currentSecrets, {
        analysisConcurrencyInput: String(nextDraft.icon_image.analysis_concurrency_limit),
        imageConcurrencyInput: String(nextDraft.icon_image.image_concurrency_limit),
      }),
    );
    setTestResults({});
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const nextSnapshot = await api.getSettings();
        if (!cancelled) {
          hydrate(nextSnapshot);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "settingsPage.feedback.loadSettingsFailed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [api]);


  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      SETTINGS_CONTEXT_KEY,
      JSON.stringify({
        title: t("settingsPage.context.title"),
        detail: t("settingsPage.context.detail"),
      }),
    );
    notifyAppContextChange();
  }, [t]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncLayoutMode = () => {
      const compact = window.innerWidth < COMPACT_SETTINGS_BREAKPOINT;
      setIsCompactLayout(compact);
      if (!compact) {
        setCategoryDialogOpen(false);
      }
    };

    syncLayoutMode();
    window.addEventListener("resize", syncLayoutMode);
    return () => {
      window.removeEventListener("resize", syncLayoutMode);
    };
  }, []);

  const updateDraft = <K extends keyof DraftState>(key: K, updater: (current: DraftState[K]) => DraftState[K]) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        [key]: updater(current[key]),
      };
    });
    setSuccess(null);
  };

  const commitAnalysisConcurrencyInput = () => {
    setDraft((current) => {
      if (!current) return current;
      const nextValue = clampConcurrencyInput(analysisConcurrencyInput, current.icon_image.analysis_concurrency_limit);
      setAnalysisConcurrencyInput(String(nextValue));
      return {
        ...current,
        icon_image: {
          ...current.icon_image,
          analysis_concurrency_limit: nextValue,
        },
      };
    });
  };

  const commitImageConcurrencyInput = () => {
    setDraft((current) => {
      if (!current) return current;
      const nextValue = clampConcurrencyInput(imageConcurrencyInput, current.icon_image.image_concurrency_limit);
      setImageConcurrencyInput(String(nextValue));
      return {
        ...current,
        icon_image: {
          ...current.icon_image,
          image_concurrency_limit: nextValue,
        },
      };
    });
  };

  const updateGlobal = (key: string, value: unknown) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        global_config: {
          ...current.global_config,
          [key]: value,
        },
      };
    });
    setSuccess(null);
  };

  const buildModelLookupPayload = (family: PresetConfigFamily) => {
    if (!draft) {
      return null;
    }
    if (family === "text") {
      return {
        family,
        ...buildFamilySavePayload("text", {
          OPENAI_BASE_URL: draft.text.OPENAI_BASE_URL,
          OPENAI_MODEL: draft.text.OPENAI_MODEL,
        }),
        secret: buildSecretPayload(textSecret),
      };
    }
    if (family === "vision") {
      return {
        family,
        mode: getVisionSourceMode(draft.global_config),
        ...(getVisionSourceMode(draft.global_config) === "shared_text"
          ? buildFamilySavePayload("text", {
            OPENAI_BASE_URL: draft.text.OPENAI_BASE_URL,
            OPENAI_MODEL: draft.text.OPENAI_MODEL,
          })
          : buildFamilySavePayload("vision", {
            IMAGE_ANALYSIS_NAME: draft.vision.IMAGE_ANALYSIS_NAME,
            IMAGE_ANALYSIS_BASE_URL: draft.vision.IMAGE_ANALYSIS_BASE_URL,
            IMAGE_ANALYSIS_MODEL: draft.vision.IMAGE_ANALYSIS_MODEL,
          })),
        secret: getVisionSourceMode(draft.global_config) === "shared_text" ? buildSecretPayload(textSecret) : buildSecretPayload(visionSecret),
      };
    }
    return {
      family,
      preset: {
        image_model: {
          base_url: draft.icon_image.image_model.base_url,
          model: draft.icon_image.image_model.model,
        },
      },
      secret: buildSecretPayload(iconSecret),
    };
  };

  const handleFetchModels = async (family: PresetConfigFamily) => {
    const payload = buildModelLookupPayload(family);
    if (!payload) {
      return;
    }
    setLoadingModelsFamily(family);
    setError(null);
    setModelLookupResults((current) => ({ ...current, [family]: undefined }));
    try {
      const result = await api.listSettingsModels(payload);
      setModelLookupResults((current) => ({ ...current, [family]: result }));
    } catch (err) {
      setModelLookupResults((current) => ({
        ...current,
        [family]: {
          status: "error",
          family,
          code: "request_failed",
          message: err instanceof Error ? err.message : "settingsPage.feedback.fetchModelListFailed",
          models: [],
        },
      }));
    } finally {
      setLoadingModelsFamily(null);
    }
  };

  const handleActivatePreset = async (family: PresetConfigFamily, presetId: string) => {
    if (isDirty) {
      setSwitchPresetDialog({ family, presetId });
      return;
    }
    await performActivatePreset(family, presetId);
  };

  const performActivatePreset = async (family: PresetConfigFamily, presetId: string) => {
    setLoading(true);
    setError(null);
    try {
      await api.activateSettingsPreset(family, presetId);
      hydrate(await api.getSettings());
      setSuccess("settingsPage.feedback.presetSwitched");
    } catch (err) {
      setError(err instanceof Error ? err.message : "settingsPage.feedback.switchPresetFailed");
    } finally {
      setLoading(false);
    }
  };

  const performCreatePreset = async (family: PresetConfigFamily, presetName: string) => {
    if (!draft) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (family === "text") {
        await api.createSettingsPreset("text", {
          name: presetName.trim(),
          copy_from_active: true,
          preset: {
            OPENAI_BASE_URL: draft.text.OPENAI_BASE_URL,
            OPENAI_MODEL: draft.text.OPENAI_MODEL,
          },
          secret: buildSecretPayload(textSecret),
        });
      } else if (family === "vision") {
        await api.createSettingsPreset("vision", {
          name: presetName.trim(),
          copy_from_active: true,
          preset: {
            IMAGE_ANALYSIS_BASE_URL: draft.vision.IMAGE_ANALYSIS_BASE_URL,
            IMAGE_ANALYSIS_MODEL: draft.vision.IMAGE_ANALYSIS_MODEL,
          },
          secret: buildSecretPayload(visionSecret),
        });
      } else {
        await api.createSettingsPreset("icon_image", {
          name: presetName.trim(),
          copy_from_active: true,
          preset: {
            image_model: {
              base_url: draft.icon_image.image_model.base_url,
              model: draft.icon_image.image_model.model,
            },
            image_size: normalizeImageSize(draft.icon_image.image_size),
            analysis_concurrency_limit: clampConcurrencyInput(analysisConcurrencyInput, draft.icon_image.analysis_concurrency_limit),
            image_concurrency_limit: clampConcurrencyInput(imageConcurrencyInput, draft.icon_image.image_concurrency_limit),
            save_mode: draft.icon_image.save_mode,
          },
          secret: buildSecretPayload(iconSecret),
        });
      }
      hydrate(await api.getSettings());
      setSuccess("settingsPage.feedback.presetCreated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "settingsPage.feedback.createPresetFailed");
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePreset = (family: PresetConfigFamily) => {
    setCreatePresetDialog({
      family,
      value:
        family === "text"
          ? t("settingsPage.feedback.newTextPreset")
          : family === "vision"
            ? t("settingsPage.feedback.newVisionPreset")
            : t("settingsPage.feedback.newIconPreset"),
    });
  };

  const handleSelectTab = (tabId: string) => {
    setActiveTab(tabId === "vision" ? "text" : tabId);
    setCategoryDialogOpen(false);
  };

  const performDeletePreset = async (family: PresetConfigFamily, presetId: string) => {
    setLoading(true);
    setError(null);
    try {
      await api.deleteSettingsPreset(family, presetId);
      hydrate(await api.getSettings());
      setSuccess("settingsPage.feedback.presetDeleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "settingsPage.feedback.deletePresetFailed");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePreset = (family: PresetConfigFamily, presetId: string, presetName: string) => {
    setDeletePresetDialog({ family, presetId, presetName });
  };

  const buildSavePayload = (): SettingsUpdatePayload | null => {
    if (!draft) {
      return null;
    }
    const families: NonNullable<SettingsUpdatePayload["families"]> = {
      bg_removal: {
        mode: draft.bg_removal.mode,
        preset: {
          preset_id: draft.bg_removal.preset_id ?? undefined,
        },
        custom: {
          name: draft.bg_removal.custom.name,
          model_id: draft.bg_removal.custom.model_id,
          api_type: draft.bg_removal.custom.api_type,
          payload_template: draft.bg_removal.custom.payload_template,
        },
        secret: buildSecretPayload(bgRemovalSecret),
      },
    };

    // Always persist model families so first-run (empty active_preset_id) can create a real preset on save.
    families.text = {
      ...buildFamilySavePayload("text", {
        OPENAI_BASE_URL: draft.text.OPENAI_BASE_URL,
        OPENAI_MODEL: draft.text.OPENAI_MODEL,
      }),
      secret: buildSecretPayload(textSecret),
    };

    const visionMode = getVisionSourceMode(draft.global_config);
    families.vision = {
      enabled: Boolean(draft.global_config.IMAGE_ANALYSIS_ENABLED),
      mode: visionMode,
      ...(visionMode === "separate" || snapshot?.families.vision.active_preset_id
        ? {
            ...buildFamilySavePayload("vision", {
              IMAGE_ANALYSIS_NAME: draft.vision.IMAGE_ANALYSIS_NAME,
              IMAGE_ANALYSIS_BASE_URL: draft.vision.IMAGE_ANALYSIS_BASE_URL,
              IMAGE_ANALYSIS_MODEL: draft.vision.IMAGE_ANALYSIS_MODEL,
            }),
            secret: buildSecretPayload(visionSecret),
          }
        : {}),
    };

    families.icon_image = {
      ...buildFamilySavePayload("icon_image", {
        image_model: {
          base_url: draft.icon_image.image_model.base_url,
          model: draft.icon_image.image_model.model,
        },
        image_size: normalizeImageSize(draft.icon_image.image_size),
        analysis_concurrency_limit: clampConcurrencyInput(analysisConcurrencyInput, draft.icon_image.analysis_concurrency_limit),
        image_concurrency_limit: clampConcurrencyInput(imageConcurrencyInput, draft.icon_image.image_concurrency_limit),
        save_mode: draft.icon_image.save_mode,
      }),
      secret: buildSecretPayload(iconSecret),
    };

    return {
      global_config: draft.global_config,
      families,
    };
  };

  const handleSave = async () => {
    const payload = buildSavePayload();
    if (!payload) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const nextSnapshot = await api.updateSettings(payload);
      hydrate(nextSnapshot);
      saveUiLanguage(normalizeSavedUiLanguage(nextSnapshot.global_config.UI_LANGUAGE));
      setSuccess("settingsPage.feedback.settingsSaved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "settingsPage.feedback.saveFailed");
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    if (snapshot) {
      hydrate(snapshot);
    }
  };

  const resolveBgRemovalRuntimeConfig = async () => {
    const stored = await api.getSettingsRuntime<{
      name?: string;
      model_id?: string;
      api_type?: string;
      payload_template?: string;
      api_token?: string;
    }>("bg_removal");

    const builtin = snapshot?.families.bg_removal.builtin_presets.find((item) => item.id === draft?.bg_removal.preset_id) ?? null;
    const secretPayload = buildSecretPayload(bgRemovalSecret);

    return {
      modelId: draft?.bg_removal.mode === "custom" ? draft.bg_removal.custom.model_id : builtin?.model_id ?? stored.model_id ?? "",
      apiType: draft?.bg_removal.mode === "custom" ? draft.bg_removal.custom.api_type : builtin?.api_type ?? stored.api_type ?? "gradio_space",
      payloadTemplate:
        draft?.bg_removal.mode === "custom"
          ? draft.bg_removal.custom.payload_template
          : builtin?.payload_template ?? stored.payload_template ?? "",
      apiToken:
        secretPayload.action === "replace"
          ? secretPayload.value ?? null
          : secretPayload.action === "clear"
            ? null
            : stored.api_token ?? null,
    };
  };

  const handleTest = async (family: SettingsFamily) => {
    if (!draft) {
      return;
    }
    setTestingFamily(family);
    setError(null);
    try {
      if (family === "bg_removal") {
        if (!desktopReady) {
          setTestResults((current) => ({
            ...current,
            bg_removal: {
              status: "error",
              family: "bg_removal",
              code: "desktop_unavailable",
              message: t("diagnostics.settingsTests.errors.desktopUnavailable"),
            },
          }));
          return;
        }
        const runtimeConfig = await resolveBgRemovalRuntimeConfig();
        const tauriResult = await invokeTauriCommandOrThrow<{ status: string; message_code: string }>(
          "test_bg_removal_connection",
          { config: runtimeConfig },
          t("diagnostics.settingsTests.errors.bgRemovalFailed"),
        );
        setTestResults((current) => ({
          ...current,
          bg_removal: {
            status: tauriResult.status === "ok" && tauriResult.message_code === "BG_REMOVAL_CONNECTION_OK" ? "ok" : "error",
            family: "bg_removal",
            code: tauriResult.message_code === "BG_REMOVAL_CONNECTION_OK" ? "ok" : "unknown",
            message: tauriResult.message_code === "BG_REMOVAL_CONNECTION_OK"
              ? t("diagnostics.settingsTests.success.bg_removal")
              : t("diagnostics.settingsTests.errors.bgRemovalFailed"),
          },
        }));
        return;
      }
      const result =
        family === "text"
          ? await api.testSettings({
            family,
            ...buildFamilySavePayload("text", {
              OPENAI_BASE_URL: draft.text.OPENAI_BASE_URL,
              OPENAI_MODEL: draft.text.OPENAI_MODEL,
            }),
            secret: buildSecretPayload(textSecret),
          })
          : family === "vision"
            ? await api.testSettings({
              family,
              mode: getVisionSourceMode(draft.global_config),
              ...(getVisionSourceMode(draft.global_config) === "shared_text"
                ? buildFamilySavePayload("text", {
                  OPENAI_BASE_URL: draft.text.OPENAI_BASE_URL,
                  OPENAI_MODEL: draft.text.OPENAI_MODEL,
                })
                : buildFamilySavePayload("vision", {
                  IMAGE_ANALYSIS_NAME: draft.vision.IMAGE_ANALYSIS_NAME,
                  IMAGE_ANALYSIS_BASE_URL: draft.vision.IMAGE_ANALYSIS_BASE_URL,
                  IMAGE_ANALYSIS_MODEL: draft.vision.IMAGE_ANALYSIS_MODEL,
                })),
              secret: getVisionSourceMode(draft.global_config) === "shared_text" ? buildSecretPayload(textSecret) : buildSecretPayload(visionSecret),
            })
            : await api.testSettings({
              family,
              ...buildFamilySavePayload("icon_image", {
                image_model: {
                  base_url: draft.icon_image.image_model.base_url,
                  model: draft.icon_image.image_model.model,
                },
                image_size: normalizeImageSize(draft.icon_image.image_size),
                analysis_concurrency_limit: clampConcurrencyInput(analysisConcurrencyInput, draft.icon_image.analysis_concurrency_limit),
                image_concurrency_limit: clampConcurrencyInput(imageConcurrencyInput, draft.icon_image.image_concurrency_limit),
                save_mode: draft.icon_image.save_mode,
              }),
              secret: buildSecretPayload(iconSecret),
            });
      setTestResults((current) => ({ ...current, [family]: result }));
    } catch (err) {
      const message = localizeUserFacingError(err, t("diagnostics.settingsTests.errors.requestFailed"));
      setTestResults((current) => ({
        ...current,
        [family]: {
          status: "error",
          family,
          code: getUserFacingErrorCode(err) || "request_failed",
          message,
        },
      }));
      setError(null);
    } finally {
      setTestingFamily(null);
    }
  };

  const connectionTestControls: ConnectionTestControls = {
    testingFamily,
    results: testResults,
    onTest: (family) => void handleTest(family),
  };

  const modelLookupControls: ModelLookupControls = {
    results: modelLookupResults,
    loadingFamily: loadingModelsFamily,
    onFetch: (family) => void handleFetchModels(family),
  };

  if (loading || !draft || !snapshot) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-9 w-9 animate-spin text-primary/45" />
          <p className="text-[13px] font-semibold text-on-surface-variant/70">
            {t("settingsPage.feedback.loadingSettings")}
          </p>
        </div>
      </div>
    );
  }

  const visionMode = getVisionSourceMode(draft.global_config);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <div className="flex w-full flex-1 overflow-hidden">
        {/* Left Sidebar Navigation */}
        {!isCompactLayout && (
          <aside className="w-[260px] 2xl:w-[280px] shrink-0 overflow-y-auto border-r border-on-surface/10 bg-surface-container-lowest px-3 py-4 scrollbar-none flex flex-col justify-between">
            <div className="space-y-1">
              <div className="px-3 pb-1 text-[11px] font-bold tracking-wider text-on-surface-variant/50">
                {t("settingsPage.categoriesHeading")}
              </div>
              {categories.map((cat) => {
                const active = activeTab === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleSelectTab(cat.id)}
                    className={cn(
                      "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all outline-none",
                      active
                        ? "bg-primary/10 text-primary font-bold shadow-[0_1px_2px_rgba(0,120,212,0.06)] border border-primary/20"
                        : "bg-transparent border border-transparent text-on-surface/80 hover:bg-on-surface/[0.04]",
                    )}
                  >
                    <div className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                      active ? "bg-primary text-white" : "bg-on-surface/5 text-on-surface-variant group-hover:text-on-surface",
                    )}>
                      <cat.icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={cn("text-[13px] font-bold leading-tight", active ? "text-primary font-bold" : "text-on-surface")}>{cat.label}</p>
                        {dirtyTabs[cat.id] ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label={t("settingsPage.unsaved.categoryLabel", { category: cat.label })} />
                        ) : null}
                      </div>
                      <p className={cn("mt-1 truncate text-[11px] leading-tight font-medium", active ? "text-primary/70" : "text-on-surface-variant/65")}>{cat.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 rounded-xl border border-on-surface/8 bg-surface/60 p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-primary">
                <div className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] font-bold text-on-surface/75">{t("settingsPage.health.title")}</span>
                </div>
                <span className="text-[11px] font-bold font-mono text-primary bg-primary/10 rounded-full px-2 py-0.5">
                  {t("settingsPage.health.ready", { count: configuredHealthCount, total: healthItems.length })}
                </span>
              </div>
              <div className="mt-2.5 space-y-1.5">
                {healthItems.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleSelectTab(item.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-on-surface/[0.05]"
                    title={t("settingsPage.health.goToSettings", { label: item.label })}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <item.icon className="h-3.5 w-3.5 shrink-0 text-on-surface-variant/50" />
                      <span className="truncate text-[11px] font-semibold text-on-surface/75">{item.label}</span>
                    </div>
                    {item.configured ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        <Check className="h-2.5 w-2.5" />
                        {t("settingsPage.health.configured")}
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-on-surface-variant/45">
                        {item.optional ? t("settingsPage.health.optional") : t("settingsPage.health.notConfigured")}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Right Content Area */}
        <main className="flex-1 overflow-y-auto bg-surface relative scrollbar-thin outline-none">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="mx-auto max-w-[880px] pb-28 pt-6 px-6"
          >
            {isCompactLayout && (
              <div className="mb-6 rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ui-muted">{t("settingsPage.compact.currentCategory")}</p>
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14px] font-bold text-on-surface">{activeCategory.label}</p>
                      {dirtyTabs[activeCategory.id] ? (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                          aria-label={t("settingsPage.unsaved.categoryLabel", { category: activeCategory.label })}
                        />
                      ) : null}
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setCategoryDialogOpen(true)}>
                    {t("settingsPage.compact.switchCategory")}
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-on-surface/6 pt-3">
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary/55">{t("settingsPage.compact.health")}</span>
                  <span className="text-[11px] font-bold text-on-surface/50">
                    {t("settingsPage.health.available", { count: configuredHealthCount, total: healthItems.length })}
                  </span>
                  {healthItems.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => handleSelectTab(item.id)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-bold transition-colors",
                        item.configured ? "bg-success/10 text-success-dim hover:bg-success/15" : "bg-on-surface/5 text-on-surface/35 hover:bg-on-surface/10",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && (
              <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
                <ErrorAlert
                  title={t("settingsPage.feedback.actionFailed")}
                  message={error.startsWith("settingsPage.") ? t(error) : error}
                  onClose={() => setError(null)}
                />
              </div>
            )}
            {success && (
              <div className="mb-6 flex items-center gap-2.5 rounded-[6px] border border-success/15 bg-success/5 px-4 py-3 text-[13px] font-bold text-success-dim animate-in fade-in slide-in-from-top-2 duration-300">
                <CheckCircle2 className="h-4 w-4" />
                {t(success)}
              </div>
            )}

            {activeTab === "text" && (
              <TextTab
                textDraft={draft.text}
                visionDraft={draft.vision}
                visionEnabled={Boolean(draft.global_config.IMAGE_ANALYSIS_ENABLED)}
                visionMode={visionMode}
                textPresets={snapshot.families.text.presets.map((item) => ({
                  id: item.id,
                  name: getPresetDisplayName("text", item.id, item.name),
                }))}
                textActivePresetId={snapshot.families.text.active_preset_id}
                visionPresets={snapshot.families.vision.presets.map((item) => ({
                  id: item.id,
                  name: getPresetDisplayName("vision", item.id, item.name),
                }))}
                visionActivePresetId={snapshot.families.vision.active_preset_id}
                textSecret={textSecret}
                setTextSecret={setTextSecret}
                visionSecret={visionSecret}
                setVisionSecret={setVisionSecret}
                onUpdateText={(updater) => updateDraft("text", updater)}
                onUpdateVision={(updater) => updateDraft("vision", updater)}
                onUpdateGlobal={updateGlobal}
                onActivatePreset={(family, presetId) => void handleActivatePreset(family, presetId)}
                onCreatePreset={handleCreatePreset}
                onDeletePreset={(family, presetId, presetName) => void handleDeletePreset(family, presetId, presetName)}
                connectionTest={connectionTestControls}
                modelLookup={modelLookupControls}
              />
            )}

            {activeTab === "icon_image" && (
              <IconImageTab
                iconImage={draft.icon_image}
                presets={snapshot.families.icon_image.presets.map((item) => ({
                  id: item.id,
                  name: getPresetDisplayName("icon_image", item.id, item.name),
                }))}
                activePresetId={snapshot.families.icon_image.active_preset_id}
                textConfigured={Boolean(snapshot.status.text_configured)}
                iconImageConfigured={Boolean(snapshot.status.icon_image_configured)}
                analysisConcurrencyInput={analysisConcurrencyInput}
                imageConcurrencyInput={imageConcurrencyInput}
                onChangeAnalysisConcurrencyInput={setAnalysisConcurrencyInput}
                onChangeImageConcurrencyInput={setImageConcurrencyInput}
                onCommitAnalysisConcurrencyInput={commitAnalysisConcurrencyInput}
                onCommitImageConcurrencyInput={commitImageConcurrencyInput}
                advancedOpen={iconAdvancedOpen}
                onToggleAdvanced={() => setIconAdvancedOpen((open) => !open)}
                iconSecret={iconSecret}
                setIconSecret={setIconSecret}
                onUpdate={(updater) => updateDraft("icon_image", updater)}
                onActivatePreset={(presetId) => void handleActivatePreset("icon_image", presetId)}
                onCreatePreset={() => handleCreatePreset("icon_image")}
                onDeletePreset={(presetId, presetName) => void handleDeletePreset("icon_image", presetId, presetName)}
                onGoToTextTab={() => handleSelectTab("text")}
                connectionTest={connectionTestControls}
                modelLookup={modelLookupControls}
              />
            )}

            {activeTab === "bg_removal" && (
              <BgRemovalTab
                bgRemoval={draft.bg_removal}
                builtinPresets={snapshot.families.bg_removal.builtin_presets}
                onUpdate={(updater) => updateDraft("bg_removal", updater)}
                secretField={
                  <SecretField
                    label={t("settingsPage.feedback.huggingFaceTokenOptional")}
                    state={draft.bg_removal.custom.secret_state}
                    secret={bgRemovalSecret}
                    setSecret={setBgRemovalSecret}
                    family="bg_removal"
                  />
                }
                connectionTestPanel={
                  <ConnectionTestPanel
                    family="bg_removal"
                    disabled={!desktopReady}
                    isTesting={testingFamily === "bg_removal"}
                    result={testResults.bg_removal}
                    onTest={() => void handleTest("bg_removal")}
                  />
                }
              />
            )}

            {activeTab === "launch" && (
              <LaunchTab
                globalConfig={draft.global_config}
                activeSection={activeLaunchSection}
                onSelectSection={setActiveLaunchSection}
                onUpdateGlobal={updateGlobal}
                onPickDirectory={async () => {
                  if (desktopReady) {
                    return pickDirectoryWithTauri();
                  }
                  return null;
                }}
              />
            )}

            {activeTab === "system" && (
              <SystemTab
                appVersion={appVersion}
                checkingUpdate={checkingUpdate}
                cooldown={cooldown}
                updateResult={updateResult}
                updateError={updateError}
                debugMode={Boolean(draft.global_config.DEBUG_MODE)}
                uiLanguage={normalizeSavedUiLanguage(draft.global_config.UI_LANGUAGE)}
                runtimeLogPath={snapshot?.runtime.log_paths.runtime_log || ""}
                debugLogPath={snapshot?.runtime.log_paths.debug_log || ""}
                onCheckUpdate={() => void handleCheckUpdate()}
                onOpenLink={handleOpenLink}
                onToggleDebugMode={() => updateGlobal("DEBUG_MODE", !draft.global_config.DEBUG_MODE)}
                onChangeUiLanguage={(language) => updateGlobal("UI_LANGUAGE", language)}
                onCopyPath={(path) =>
                  copyTextToClipboard(path, setSuccess, setError, {
                    unsupported: "settingsPage.feedback.clipboardUnavailable",
                    copied: "settingsPage.feedback.pathCopied",
                    failed: "settingsPage.feedback.pathCopyFailed",
                  })
                }
              />
            )}
          </motion.div>

          <AnimatePresence>
            {isDirty && (
              <motion.div
                initial={{ y: 20, opacity: 0, x: "-50%" }}
                animate={{ y: 0, opacity: 1, x: "-50%" }}
                exit={{ y: 20, opacity: 0, x: "-50%" }}
                className={cn(
                  "fixed bottom-8 z-50 flex items-center gap-3 rounded-[12px] border border-primary/30 bg-surface/90 px-4 py-3 backdrop-blur-xl",
                  isCompactLayout ? "left-1/2" : "left-[calc(50%+130px)] 2xl:left-[calc(50%+150px)]",
                )}
              >
                <div className="mr-4 flex flex-col">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-primary">{t("settingsPage.unsaved.title")}</span>
                  <span className="text-[11px] font-medium text-on-surface/40">
                    {dirtyTabLabels.length
                      ? t("settingsPage.unsaved.categories", { categories: dirtyTabList })
                      : t("settingsPage.unsaved.fallback")}
                  </span>
                </div>
                <div className="h-8 w-px bg-primary/10" />
                <Button variant="secondary" onClick={discardChanges} disabled={saving} className="h-9 px-4 text-[13px] font-bold">
                  {t("settingsPage.unsaved.discard")}
                </Button>
                <Button onClick={() => void handleSave()} loading={saving} disabled={saving} className="h-9 px-5 text-[13px] font-bold border border-primary/20 bg-primary active:bg-primary-dim">
                  {t("settingsPage.unsaved.save")}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t("settingsPage.categoryDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {categories.map((cat) => {
              const active = activeTab === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleSelectTab(cat.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-[8px] border px-4 py-3 text-left transition-colors",
                    active
                      ? "border-primary/20 bg-primary/8 text-primary"
                      : "border-on-surface/8 bg-surface hover:border-primary/16 hover:bg-surface-container-low",
                  )}
                >
                  <cat.icon className="h-4.5 w-4.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-bold">{cat.label}</p>
                      {dirtyTabs[cat.id] ? (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                          aria-label={t("settingsPage.unsaved.categoryLabel", { category: cat.label })}
                        />
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] font-medium text-ui-muted">{cat.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(createPresetDialog)}
        title={
          createPresetDialog?.family === "text"
            ? t("settingsPage.feedback.createTextPresetTitle")
            : createPresetDialog?.family === "vision"
              ? t("settingsPage.feedback.createVisionPresetTitle")
              : t("settingsPage.feedback.createIconPresetTitle")
        }
        description={t("settingsPage.feedback.createPresetDescription")}
        confirmLabel={t("settingsPage.feedback.createAndSwitch")}
        cancelLabel={t("settingsPage.feedback.cancel")}
        loading={loading}
        onConfirm={async () => {
          if (!createPresetDialog?.value.trim()) {
            setError("settingsPage.feedback.presetNameRequired");
            return;
          }
          const dialog = createPresetDialog;
          setCreatePresetDialog(null);
          await performCreatePreset(dialog.family, dialog.value);
        }}
        onCancel={() => setCreatePresetDialog(null)}
      >
        <div className="space-y-2">
          <label className="text-[12px] font-semibold text-on-surface-variant/70">
            {t("settingsPage.feedback.presetNameLabel")}
          </label>
          <input
            autoFocus
            value={createPresetDialog?.value ?? ""}
            onChange={(event) => setCreatePresetDialog((current) => (current ? { ...current, value: event.target.value } : current))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && createPresetDialog?.value.trim()) {
                void (async () => {
                  const dialog = createPresetDialog;
                  if (!dialog) return;
                  setCreatePresetDialog(null);
                  await performCreatePreset(dialog.family, dialog.value);
                })();
              }
            }}
            className="w-full rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3 text-[14px] font-semibold text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary focus:ring-4 focus:ring-primary/5"
            placeholder={t("settingsPage.feedback.presetNamePlaceholder")}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deletePresetDialog)}
        title={t("settingsPage.feedback.deletePresetTitle")}
        description={
          deletePresetDialog
            ? t("settingsPage.feedback.deletePresetDescription", { name: deletePresetDialog.presetName })
            : ""
        }
        confirmLabel={t("settingsPage.feedback.delete")}
        cancelLabel={t("settingsPage.feedback.cancel")}
        loading={loading}
        onConfirm={async () => {
          if (!deletePresetDialog) return;
          const dialog = deletePresetDialog;
          setDeletePresetDialog(null);
          await performDeletePreset(dialog.family, dialog.presetId);
        }}
        onCancel={() => setDeletePresetDialog(null)}
      />

      <ConfirmDialog
        open={Boolean(switchPresetDialog)}
        title={t("settingsPage.unsaved.switchTitle")}
        description={t("settingsPage.unsaved.switchDescription")}
        confirmLabel={t("settingsPage.unsaved.confirmSwitch")}
        cancelLabel={t("settingsPage.unsaved.cancel")}
        loading={loading}
        onConfirm={async () => {
          if (!switchPresetDialog) return;
          const dialog = switchPresetDialog;
          setSwitchPresetDialog(null);
          await performActivatePreset(dialog.family, dialog.presetId);
        }}
        onCancel={() => setSwitchPresetDialog(null)}
      />
</div>
  );
}
