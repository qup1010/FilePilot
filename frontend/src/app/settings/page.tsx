"use client";

import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
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
import { getApiBaseUrl, getApiToken, invokeTauriCommand, isTauriDesktop, pickDirectoryWithTauri, openUrlWithTauri } from "@/lib/runtime";
import { cn } from "@/lib/utils";
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
        throw new Error(`GitHub API 返回状态 ${res.status}`);
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
      setUpdateError(err.message || "无法连接至 GitHub 获取最新发布版本，请检查代理或网络连接。");
    } finally {
      setCheckingUpdate(false);
    }
  }, [checkingUpdate, cooldown, appVersion]);

  const handleOpenLink = useCallback((url: string, e: React.MouseEvent) => {
    if (isTauriDesktop()) {
      e.preventDefault();
      void openUrlWithTauri(url);
    }
  }, []);

  const categories = [
    { id: "text", label: "整理模型配置", icon: Layers3, description: "配置文本分析与图片理解模型" },
    { id: "launch", label: "整理策略配置", icon: SettingsIcon, description: "配置任务启动默认参数与规则" },
    { id: "icon_image", label: "生图模型配置", icon: ImageIcon, description: "配置图标生成模型参数" },
    { id: "bg_removal", label: "抠图服务配置", icon: Scissors, description: "配置抠图模型端点与参数" },
    { id: "system", label: "关于与运行日志", icon: ShieldCheck, description: "项目版本、检查更新与系统日志" },
  ];

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
  const healthItems = useMemo(
    () => [
      {
        id: "text" as const,
        label: "文本分析",
        description: "整理规划必需",
        configured: Boolean(snapshot?.status.text_configured),
        optional: false,
        icon: Layers3,
      },
      {
        id: "text" as const,
        label: "图片理解",
        description: "图片/截图增强",
        configured: Boolean(snapshot?.status.vision_configured),
        optional: true,
        icon: Globe,
      },
      {
        id: "icon_image" as const,
        label: "图标生成",
        description: "图标工坊需要",
        configured: Boolean(snapshot?.status.icon_image_configured),
        optional: true,
        icon: ImageIcon,
      },
      {
        id: "bg_removal" as const,
        label: "背景处理",
        description: "透明图标增强",
        configured: Boolean(snapshot?.status.bg_removal_configured),
        optional: true,
        icon: Scissors,
      },
    ],
    [snapshot?.status.bg_removal_configured, snapshot?.status.icon_image_configured, snapshot?.status.text_configured, snapshot?.status.vision_configured],
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
          setError(err instanceof Error ? err.message : "读取设置失败");
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
        title: "设置",
        detail: "模型与工具配置",
      }),
    );
    notifyAppContextChange();
  }, []);

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
          message: err instanceof Error ? err.message : "获取模型列表失败",
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
      setSuccess("预设已切换");
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换预设失败");
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
      setSuccess("新预设已创建并激活");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建预设失败");
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePreset = (family: PresetConfigFamily) => {
    setCreatePresetDialog({
      family,
      value: family === "text" ? "新的文本预设" : family === "vision" ? "新的图片理解预设" : "新的图标生图预设",
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
      setSuccess("预设已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除预设失败");
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
      setSuccess("设置已保存并生效");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
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
          throw new Error("抠图服务测试仅支持桌面端。");
        }
        const runtimeConfig = await resolveBgRemovalRuntimeConfig();
        const tauriResult = await invokeTauriCommand<{ status: string; message: string }>("test_bg_removal_connection", {
          config: runtimeConfig,
        });
        setTestResults((current) => ({
          ...current,
          bg_removal: tauriResult
            ? {
              status: tauriResult.status === "ok" ? "ok" : "error",
              family: "bg_removal",
              code: tauriResult.status === "ok" ? "ok" : "unknown",
              message: tauriResult.message,
            }
            : {
              status: "error",
              family: "bg_removal",
              code: "desktop_unavailable",
              message: "桌面端不可用，无法执行抠图连接测试。",
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
      const message = err instanceof Error ? err.message : "连接测试失败";
      setTestResults((current) => ({
        ...current,
        [family]: {
          status: "error",
          family,
          code: "request_failed",
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
          <p className="text-[13px] font-semibold text-on-surface-variant/70">正在读取统一设置快照</p>
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
          <aside className="w-[260px] 2xl:w-[300px] shrink-0 overflow-y-auto border-r border-on-surface/8 bg-surface-container-lowest px-2 py-4 scrollbar-none">
            <div className="space-y-0.5">
              {categories.map((cat) => {
                const active = activeTab === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleSelectTab(cat.id)}
                    className={cn(
                      "group relative flex w-full items-center gap-3 rounded-[6px] px-3 py-2 text-left transition-colors outline-none",
                      active
                        ? "bg-primary/[0.06] border-primary/20"
                        : "bg-transparent border-transparent hover:bg-on-surface/[0.035]",
                    )}
                    style={{ borderWidth: '1px', borderStyle: 'solid' }}
                  >
                    {active && (
                      <div

                        className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full bg-primary"
                      />
                    )}
                    <div className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors",
                      active ? "bg-primary text-white" : "bg-transparent group-hover:bg-on-surface/[0.05] text-on-surface/40",
                    )}>
                      <cat.icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={cn("text-[13px] font-black leading-none tracking-tight", active ? "text-primary" : "text-on-surface/80")}>{cat.label}</p>
                        {dirtyTabs[cat.id] ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label={`${cat.label} 有未保存修改`} />
                        ) : null}
                      </div>
                      <p className="mt-1.5 truncate text-[11px] font-medium opacity-50">{cat.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-8 rounded-xl border border-on-surface/8 bg-on-surface/[0.02] p-4">
              <div className="flex items-center gap-2 text-primary">
                <Cpu className="h-3.5 w-3.5" />
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-primary/60">配置健康</span>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <span className="text-[18px] font-black text-on-surface">{configuredHealthCount}/{healthItems.length}</span>
                <span className="text-[11px] font-bold text-on-surface/35">能力已配置</span>
              </div>
              <div className="mt-4 space-y-2">
                {healthItems.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleSelectTab(item.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-[8px] px-1.5 py-1.5 text-left transition-colors hover:bg-on-surface/[0.04]"
                    title={`前往${item.label}配置`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <item.icon className="h-3 w-3 text-on-surface/25" />
                      <div className="min-w-0">
                        <span className="block truncate text-[11px] font-bold text-on-surface/50">{item.label}</span>
                        <span className="block truncate text-[11px] font-semibold text-on-surface/25">{item.description}</span>
                      </div>
                    </div>
                    {item.configured ? (
                      <div className="flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5">
                        <div className="h-0.5 w-0.5 rounded-full bg-success" />
                        <span className="text-[11px] font-black tracking-widest text-success-dim/80">可用</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 rounded-full bg-on-surface/5 px-1.5 py-0.5">
                        <div className="h-0.5 w-0.5 rounded-full bg-on-surface/20" />
                        <span className="text-[11px] font-black tracking-widest text-on-surface/35">{item.optional ? "可选" : "待配置"}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <div className="mt-4 border-t border-on-surface/5 pt-3">
                <p className="text-[11px] font-bold leading-relaxed text-on-surface/25">
                  文本分析是整理主链路必需；其他能力会按功能场景启用。
                </p>
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
            className="mx-auto max-w-[800px] pb-24 pt-6 px-6"
          >
            {isCompactLayout && (
              <div className="mb-6 rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ui-muted">当前分类</p>
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14px] font-black text-on-surface">{activeCategory.label}</p>
                      {dirtyTabs[activeCategory.id] ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /> : null}
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setCategoryDialogOpen(true)}>
                    切换分类
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-on-surface/6 pt-3">
                  <span className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/55">配置健康</span>
                  <span className="text-[11px] font-bold text-on-surface/50">{configuredHealthCount}/{healthItems.length} 可用</span>
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
                <ErrorAlert title="操作执行失败" message={error} onClose={() => setError(null)} />
              </div>
            )}
            {success && (
              <div className="mb-6 flex items-center gap-2.5 rounded-[6px] border border-success/15 bg-success/5 px-4 py-3 text-[13px] font-bold text-success-dim animate-in fade-in slide-in-from-top-2 duration-300">
                <CheckCircle2 className="h-4 w-4" />
                {success}
              </div>
            )}

            {activeTab === "text" && (
              <TextTab
                textDraft={draft.text}
                visionDraft={draft.vision}
                visionEnabled={Boolean(draft.global_config.IMAGE_ANALYSIS_ENABLED)}
                visionMode={visionMode}
                textPresets={snapshot.families.text.presets.map((item) => ({ id: item.id, name: item.name }))}
                textActivePresetId={snapshot.families.text.active_preset_id}
                visionPresets={snapshot.families.vision.presets.map((item) => ({ id: item.id, name: item.name }))}
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
                presets={snapshot.families.icon_image.presets.map((item) => ({ id: item.id, name: item.name }))}
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
                    label="Hugging Face Token（可选）"
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
                runtimeLogPath={snapshot?.runtime.log_paths.runtime_log || ""}
                debugLogPath={snapshot?.runtime.log_paths.debug_log || ""}
                onCheckUpdate={() => void handleCheckUpdate()}
                onOpenLink={handleOpenLink}
                onToggleDebugMode={() => updateGlobal("DEBUG_MODE", !draft.global_config.DEBUG_MODE)}
                onCopyPath={(path) => copyTextToClipboard(path, setSuccess, setError)}
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
                  <span className="text-[11px] font-black uppercase tracking-wider text-primary">设置已修改</span>
                  <span className="text-[11px] font-medium text-on-surface/40">
                    {dirtyTabLabels.length ? `将保存：${dirtyTabLabels.join("、")}` : "会保存本页未提交的修改"}
                  </span>
                </div>
                <div className="h-8 w-px bg-primary/10" />
                <Button variant="secondary" onClick={discardChanges} disabled={saving} className="h-9 px-4 text-[13px] font-bold">
                  放弃修改
                </Button>
                <Button onClick={() => void handleSave()} loading={saving} disabled={saving} className="h-9 px-5 text-[13px] font-bold border border-primary/20 bg-primary active:bg-primary-dim">
                  保存当前修改
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>切换设置分类</DialogTitle>
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
                      <p className="text-[13px] font-black">{cat.label}</p>
                      {dirtyTabs[cat.id] ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /> : null}
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
            ? "新建文本预设"
            : createPresetDialog?.family === "vision"
              ? "新建图片理解预设"
              : "新建图标生图预设"
        }
        description="输入一个清晰的预设名称。创建后会基于当前草稿生成新的激活预设。"
        confirmLabel="创建并切换"
        cancelLabel="取消"
        loading={loading}
        onConfirm={async () => {
          if (!createPresetDialog?.value.trim()) {
            setError("请输入预设名称");
            return;
          }
          const dialog = createPresetDialog;
          setCreatePresetDialog(null);
          await performCreatePreset(dialog.family, dialog.value);
        }}
        onCancel={() => setCreatePresetDialog(null)}
      >
        <div className="space-y-2">
          <label className="text-[12px] font-semibold text-on-surface-variant/70">预设名称</label>
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
            placeholder="请输入预设名称"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deletePresetDialog)}
        title="删除预设"
        description={deletePresetDialog ? `确定删除“${deletePresetDialog.presetName}”吗？删除后不能恢复。` : ""}
        confirmLabel="删除"
        cancelLabel="取消"
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
        title="切换预设并放弃草稿"
        description="当前草稿将丢失，确定切换吗？"
        confirmLabel="切换"
        cancelLabel="取消"
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
