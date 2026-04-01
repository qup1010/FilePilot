"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  ImageIcon,
  Layers3,
  RefreshCw,
  Scissors,
  Settings as SettingsIcon,
  ShieldCheck,
  Terminal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorAlert } from "@/components/ui/error-alert";
import {
  FieldGroup,
  InputShell,
  PresetSelector,
  SettingsSection,
  StrategyOptionButton,
  ToggleSwitch,
} from "@/components/settings/settings-primitives";
import { buildFamilySavePayload, isEditablePreset } from "@/app/settings/preset-flow";
import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken, invokeTauriCommand, isTauriDesktop } from "@/lib/runtime";
import {
  CAUTION_LEVEL_OPTIONS,
  getSuggestedSelection,
  getTemplateMeta,
  NAMING_STYLE_OPTIONS,
  STRATEGY_TEMPLATES,
} from "@/lib/strategy-templates";
import { cn } from "@/lib/utils";
import type {
  IconImageSettingsPreset,
  SecretAction,
  SecretState,
  SettingsFamily,
  SettingsSnapshot,
  SettingsTestResult,
  SettingsUpdatePayload,
  TextSettingsPreset,
  VisionSettingsPreset,
} from "@/types/settings";

type SecretDraft = {
  action: SecretAction;
  value: string;
  visible: boolean;
};

type PresetConfigFamily = Exclude<SettingsFamily, "bg_removal">;

type DraftState = {
  global_config: SettingsSnapshot["global_config"];
  text: TextSettingsPreset;
  vision: VisionSettingsPreset;
  icon_image: SettingsSnapshot["families"]["icon_image"]["active_preset"];
  bg_removal: {
    mode: SettingsSnapshot["families"]["bg_removal"]["mode"];
    preset_id: SettingsSnapshot["families"]["bg_removal"]["preset_id"];
    custom: SettingsSnapshot["families"]["bg_removal"]["custom"];
  };
};

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

const APP_CONTEXT_EVENT = "file-organizer-context-change";
const SETTINGS_CONTEXT_KEY = "settings_header_context";
const IMAGE_SIZE_OPTIONS = ["1024x1024", "512x512", "256x256"] as const;

function normalizeImageSize(value: string | null | undefined): (typeof IMAGE_SIZE_OPTIONS)[number] {
  if (value && IMAGE_SIZE_OPTIONS.includes(value as (typeof IMAGE_SIZE_OPTIONS)[number])) {
    return value as (typeof IMAGE_SIZE_OPTIONS)[number];
  }
  return "1024x1024";
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createSecretDraft(): SecretDraft {
  return { action: "keep", value: "", visible: false };
}

function clampConcurrencyInput(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return Math.max(1, Math.min(6, fallback || 1));
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return Math.max(1, Math.min(6, fallback || 1));
  }
  return Math.max(1, Math.min(6, Math.trunc(parsed) || 1));
}

function snapshotToDraft(snapshot: SettingsSnapshot): DraftState {
  const iconImagePreset = cloneValue(snapshot.families.icon_image.active_preset);
  return {
    global_config: cloneValue(snapshot.global_config),
    text: cloneValue(snapshot.families.text.active_preset),
    vision: cloneValue(snapshot.families.vision.active_preset),
    icon_image: {
      ...iconImagePreset,
      image_size: normalizeImageSize(iconImagePreset.image_size),
    },
    bg_removal: {
      mode: snapshot.families.bg_removal.mode,
      preset_id: snapshot.families.bg_removal.preset_id,
      custom: cloneValue(snapshot.families.bg_removal.custom),
    },
  };
}

function buildSecretPayload(secret: SecretDraft) {
  if (secret.action === "replace" && secret.value.trim()) {
    return { action: "replace" as const, value: secret.value.trim() };
  }
  if (secret.action === "clear") {
    return { action: "clear" as const };
  }
  return { action: "keep" as const };
}

function describeSecret(secretState: SecretState, secret: SecretDraft) {
  if (secret.action === "replace" && secret.value.trim()) {
    return "将用新的密钥替换已保存值";
  }
  if (secret.action === "clear") {
    return "保存后会清空已保存密钥";
  }
  return secretState === "stored" ? "当前已有密钥保存在本地" : "当前还没有保存密钥";
}

function buildFingerprint(
  draft: DraftState | null,
  secrets: Record<SettingsFamily, SecretDraft>,
  transientInputs?: {
    analysisConcurrencyInput: string;
    imageConcurrencyInput: string;
  },
) {
  if (!draft) {
    return "";
  }
  return JSON.stringify({
    draft,
    transientInputs: transientInputs ?? null,
    secrets: {
      text: { action: secrets.text.action, value: secrets.text.value },
      vision: { action: secrets.vision.action, value: secrets.vision.value },
      icon_image: { action: secrets.icon_image.action, value: secrets.icon_image.value },
      bg_removal: { action: secrets.bg_removal.action, value: secrets.bg_removal.value },
    },
  });
}

export default function SettingsPage() {
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
  const [activeTab, setActiveTab] = useState<string>("text");

  const categories = [
    { id: "text", label: "文本模型", icon: Layers3, description: "核心分析与规划" },
    { id: "vision", label: "图片理解", icon: Globe, description: "多模态识别增强" },
    { id: "icon_image", label: "图标生图", icon: ImageIcon, description: "生图模型配置" },
    { id: "bg_removal", label: "抠图服务", icon: Scissors, description: "图标背景处理" },
    { id: "launch", label: "启动默认值", icon: SettingsIcon, description: "任务启动配置" },
    { id: "system", label: "系统与调试", icon: ShieldCheck, description: "运行状态与日志" },
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

  const isDirty = useMemo(
    () =>
      buildFingerprint(draft, secretMap, {
        analysisConcurrencyInput,
        imageConcurrencyInput,
      }) !== baseline,
    [analysisConcurrencyInput, baseline, draft, imageConcurrencyInput, secretMap],
  );

  const hydrate = (nextSnapshot: SettingsSnapshot) => {
    const nextDraft = snapshotToDraft(nextSnapshot);
    const emptySecrets = {
      text: createSecretDraft(),
      vision: createSecretDraft(),
      icon_image: createSecretDraft(),
      bg_removal: createSecretDraft(),
    };
    setSnapshot(nextSnapshot);
    setDraft(nextDraft);
    setTextSecret(emptySecrets.text);
    setVisionSecret(emptySecrets.vision);
    setIconSecret(emptySecrets.icon_image);
    setBgRemovalSecret(emptySecrets.bg_removal);
    setAnalysisConcurrencyInput(String(nextDraft.icon_image.analysis_concurrency_limit));
    setImageConcurrencyInput(String(nextDraft.icon_image.image_concurrency_limit));
    setBaseline(
      buildFingerprint(nextDraft, emptySecrets, {
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
    window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
  }, []);

  const launchTemplate = getTemplateMeta(draft?.global_config.LAUNCH_DEFAULT_TEMPLATE_ID ?? "general_downloads");

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

  const handleActivatePreset = async (family: PresetConfigFamily, presetId: string) => {
    if (isDirty) {
      setSwitchPresetDialog({ family, presetId });
      return;
    }
    await performActivatePreset(family, presetId);
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
            IMAGE_ANALYSIS_NAME: draft.vision.IMAGE_ANALYSIS_NAME,
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
    if (presetId === "default") {
      return;
    }
    setDeletePresetDialog({ family, presetId, presetName });
  };

  const buildSavePayload = (): SettingsUpdatePayload | null => {
    if (!draft) {
      return null;
    }
    return {
      global_config: draft.global_config,
      families: {
        text: {
          ...buildFamilySavePayload("text", {
            OPENAI_BASE_URL: draft.text.OPENAI_BASE_URL,
            OPENAI_MODEL: draft.text.OPENAI_MODEL,
          }),
          secret: buildSecretPayload(textSecret),
        },
        vision: {
          enabled: Boolean(draft.global_config.IMAGE_ANALYSIS_ENABLED),
          ...buildFamilySavePayload("vision", {
            IMAGE_ANALYSIS_NAME: draft.vision.IMAGE_ANALYSIS_NAME,
            IMAGE_ANALYSIS_BASE_URL: draft.vision.IMAGE_ANALYSIS_BASE_URL,
            IMAGE_ANALYSIS_MODEL: draft.vision.IMAGE_ANALYSIS_MODEL,
          }),
          secret: buildSecretPayload(visionSecret),
        },
        icon_image: {
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
        },
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
      },
    };
  };

  const handleSave = async () => {
    const payload = buildSavePayload();
    if (!payload) {
      return;
    }
    setSaving(true);
    setError(null);
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
                ...buildFamilySavePayload("vision", {
                  IMAGE_ANALYSIS_NAME: draft.vision.IMAGE_ANALYSIS_NAME,
                  IMAGE_ANALYSIS_BASE_URL: draft.vision.IMAGE_ANALYSIS_BASE_URL,
                  IMAGE_ANALYSIS_MODEL: draft.vision.IMAGE_ANALYSIS_MODEL,
                }),
                secret: buildSecretPayload(visionSecret),
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
      setError(err instanceof Error ? err.message : "连接测试失败");
    } finally {
      setTestingFamily(null);
    }
  };

  const renderResult = (family: SettingsFamily) => {
    const result = testResults[family];
    const isTesting = testingFamily === family;

    if (isTesting) {
      return (
        <div className="flex items-center gap-3 rounded-[12px] border border-primary/15 bg-primary/5 px-5 py-4">
           <div className="relative h-8 w-8 shrink-0">
              <div className="absolute inset-0 animate-ping rounded-full bg-primary/20 opacity-75" />
              <div className="relative flex h-full w-full items-center justify-center rounded-full bg-primary/10 text-primary">
                 <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
           </div>
           <div className="min-w-0">
              <p className="text-[13px] font-black tracking-tight text-on-surface">正在进行端到端连接测试...</p>
              <p className="mt-0.5 text-[11px] font-bold text-primary/60 uppercase tracking-widest">Scanning Endpoint</p>
           </div>
        </div>
      );
    }

    if (!result) {
      return null;
    }

    const isOk = result.status === "ok";

    return (
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "flex items-start gap-4 rounded-[12px] border px-5 py-4 transition-all",
          isOk
            ? "border-emerald-500/20 bg-emerald-500/[0.03] shadow-[0_4px_24px_rgba(16,185,129,0.08)]"
            : "border-error/20 bg-error/[0.03] shadow-[0_4px_24px_rgba(196,49,75,0.08)]",
        )}
      >
        <div className={cn(
           "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
           isOk ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : "border-error/20 bg-error/10 text-error"
        )}>
          {isOk ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-4">
             <h4 className={cn("text-[14px] font-black tracking-tight", isOk ? "text-emerald-800" : "text-error-dim")}>
                {isOk ? "服务已成功对齐" : "连接遭到拦截"}
             </h4>
             {isOk && (
                <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-emerald-600">
                   <div className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                   Stable
                </div>
             )}
          </div>
          <p className="text-[12.5px] font-medium leading-relaxed text-on-surface/60">{result.message}</p>
          {!isOk && <p className="text-[11px] font-black uppercase tracking-widest opacity-40">Code: {result.code}</p>}
        </div>
      </motion.div>
    );
  };

  const renderSecretField = (
    label: string,
    state: SecretState,
    secret: SecretDraft,
    setSecret: Dispatch<SetStateAction<SecretDraft>>,
  ) => (
    <FieldGroup label={label}>
      <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
              <span className={cn(
                "rounded-[4px] px-2.5 py-1 text-[11px] font-bold",
                state === "stored" ? "border border-primary/12 bg-primary/8 text-primary" : "border border-on-surface/8 bg-surface-container-low text-on-surface-variant",
              )}>
                {state === "stored" ? "已保存" : "未保存"}
              </span>
              {secret.action === "replace" && secret.value.trim() ? (
                <span className="rounded-[4px] border border-emerald-500/12 bg-emerald-500/5 px-2.5 py-1 text-[11px] font-bold text-emerald-700">待替换</span>
              ) : null}
              {secret.action === "clear" ? (
                <span className="rounded-[4px] border border-error/12 bg-error/5 px-2.5 py-1 text-[11px] font-bold text-error">待清空</span>
              ) : null}
            </div>
            <p className="text-[12px] text-on-surface-variant/70">{describeSecret(state, secret)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSecret((current) => ({ ...current, action: "keep", value: "", visible: false }))}
            >
              保持
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSecret((current) => ({ ...current, action: "clear", value: "", visible: false }))}
            >
              清空
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-[4px] border border-on-surface/8 bg-surface-container-lowest px-3 py-2">
          <input
            type={secret.visible ? "text" : "password"}
            value={secret.value}
            onChange={(event) => {
              const nextValue = event.target.value;
              setSecret((current) => ({
                ...current,
                value: nextValue,
                action: nextValue.trim() ? "replace" : "keep",
              }));
            }}
            className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none placeholder:text-on-surface-variant/35"
            placeholder={state === "stored" ? "输入新密钥以替换当前已保存值" : "输入要保存的新密钥"}
          />
          <button
            type="button"
            onClick={() => setSecret((current) => ({ ...current, visible: !current.visible }))}
            className="rounded-[8px] p-2 text-on-surface-variant/45 transition-colors hover:bg-surface-container-low hover:text-on-surface"
          >
            {secret.visible ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
          </button>
        </div>
      </div>
    </FieldGroup>
  );

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

  const textPresetEditable = isEditablePreset(snapshot.families.text.active_preset_id);
  const visionPresetEditable = isEditablePreset(snapshot.families.vision.active_preset_id);
  const iconImagePresetEditable = isEditablePreset(snapshot.families.icon_image.active_preset_id);

  const renderCreatePresetHint = (label: string) => (
    <div className="rounded-[12px] border border-dashed border-on-surface/12 bg-surface px-4 py-5">
      <p className="text-sm font-semibold text-on-surface">请先点击 + 创建一个预设</p>
      <p className="mt-1 text-[12px] leading-6 text-on-surface-variant/70">
        {label} 还没有可编辑的用户预设。创建成功后再填写接口地址、模型和 API Key，保存会直接写入当前新预设。
      </p>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      {/* Top Banner / Global Actions */}
      <section className="sticky top-0 z-30 shrink-0 border-b border-on-surface/8 bg-surface-container-lowest/90 px-6 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-primary/8 text-primary">
              <SettingsIcon className="h-5.5 w-5.5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-headline text-[1.15rem] font-black tracking-tight text-on-surface">模型与工具设置</h1>
              <p className="hidden truncate text-[12px] text-on-surface/50 sm:block">
                统一管理文本模型、图片理解、图标生成和运行日志。
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Button variant="secondary" onClick={() => hydrate(snapshot)} disabled={!isDirty || saving}>
              放弃修改
            </Button>
            <Button onClick={() => void handleSave()} loading={saving} disabled={!isDirty || saving} className="shadow-lg shadow-primary/20">
              保存全部配置
            </Button>
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-[1360px] flex-1 overflow-hidden">
        {/* Left Sidebar Navigation */}
        <aside className="w-[280px] shrink-0 overflow-y-auto border-r border-on-surface/8 bg-surface/30 px-4 py-8">
          <div className="space-y-1.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveTab(cat.id)}
                className={cn(
                  "flex w-full items-center gap-3.5 rounded-[4px] border px-4 py-3 text-left transition-all duration-200",
                  activeTab === cat.id
                    ? "border-primary/10 bg-white text-primary shadow-sm ring-1 ring-primary/5"
                    : "border-transparent text-on-surface/60 hover:bg-on-surface/[0.03] hover:text-on-surface",
                )}
              >
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] transition-colors",
                  activeTab === cat.id ? "bg-primary text-white" : "bg-on-surface/5 text-on-surface/40",
                )}>
                  <cat.icon className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold leading-none">{cat.label}</p>
                  <p className="mt-1.5 truncate text-[11px] font-medium opacity-60">{cat.description}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-12 rounded-[12px] border border-on-surface/8 bg-on-surface/[0.02] p-5">
             <div className="flex items-center gap-2 text-primary">
                <Cpu className="h-4.5 w-4.5" />
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-primary/70">引擎就绪度监控</span>
             </div>
             <div className="mt-5 space-y-4">
                {[
                  { label: "文本逻辑分析", pass: snapshot.status.text_configured, icon: Layers3 },
                  { label: "视觉增强算法", pass: snapshot.status.vision_configured, icon: Globe },
                  { label: "图标生成引擎", pass: snapshot.status.icon_image_configured, icon: ImageIcon },
                  { label: "背景擦除工具", pass: snapshot.status.bg_removal_configured, icon: Scissors },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                       <item.icon className="h-3.5 w-3.5 text-on-surface/30" />
                       <span className="truncate text-[12px] font-bold text-on-surface/50">{item.label}</span>
                    </div>
                    {item.pass ? (
                       <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 pr-2.5">
                          <div className="h-1 w-1 rounded-full bg-emerald-600" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600/80">Active</span>
                       </div>
                    ) : (
                       <div className="flex items-center gap-1.5 rounded-full bg-on-surface/5 px-2 py-0.5 pr-2.5">
                          <div className="h-1 w-1 rounded-full bg-on-surface/30" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-on-surface/30">Idle</span>
                       </div>
                    )}
                  </div>
                ))}
             </div>
             <div className="mt-6 border-t border-on-surface/5 pt-4">
                <p className="text-[11px] font-bold leading-relaxed text-on-surface/30">
                   建议在开始大规模整理任务前，确保所有显示为 <span className="text-emerald-600/60">Active</span> 的模型均已通过端到端连接测试。
                </p>
             </div>
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="flex-1 overflow-y-auto px-6 py-8 scrollbar-thin lg:px-10">
          <div className="mx-auto max-w-[860px]">
            {error && (
              <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
                <ErrorAlert title="操作执行失败" message={error} onClose={() => setError(null)} />
              </div>
            )}
            {success && (
              <div className="mb-6 flex items-center gap-3 rounded-[6px] border border-emerald-500/10 bg-emerald-500/5 px-5 py-4 text-[13px] font-bold text-emerald-700 animate-in fade-in slide-in-from-top-2 duration-300">
                <CheckCircle2 className="h-5 w-5" />
                {success}
              </div>
            )}

            {activeTab === "text" && (
              <SettingsSection
                icon={Layers3}
                title="文本模型"
                description="整理任务和图标工坊都会读取这里当前启用的文本预设。支持 OpenAI 兼容的 Chat Completions 接口。"
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleTest("text")}
                    loading={testingFamily === "text"}
                  >
                    测试文本连接
                  </Button>
                }
              >
                <PresetSelector
                  label="文本预设"
                  presets={snapshot.families.text.presets.map((item) => ({ id: item.id, name: item.name }))}
                  activeId={snapshot.families.text.active_preset_id}
                  onSwitch={(id) => void handleActivatePreset("text", id)}
                  onAdd={() => handleCreatePreset("text")}
                  onDelete={(preset) => void handleDeletePreset("text", preset.id, preset.name)}
                />
                {renderResult("text")}
                <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-3">
                  <p className="text-[12px] font-semibold text-on-surface">支持的接口类型</p>
                  <p className="mt-1 text-[12px] leading-6 text-on-surface-variant/70">
                    适用于 OpenAI 兼容的文本聊天接口。接口地址建议填写到 <span className="font-mono text-on-surface">/v1</span>，例如
                    <span className="font-mono text-on-surface"> https://api.openai.com/v1</span> 或
                    <span className="font-mono text-on-surface"> https://dashscope.aliyuncs.com/compatible-mode/v1</span>。
                  </p>
                </div>
                {textPresetEditable ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <FieldGroup label="模型 ID">
                      <InputShell icon={Terminal}>
                        <input value={draft.text.OPENAI_MODEL} onChange={(event) => updateDraft("text", (current) => ({ ...current, OPENAI_MODEL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none" placeholder="gpt-5.4" />
                      </InputShell>
                    </FieldGroup>
                    <FieldGroup label="接口地址" hint="建议填写到 /v1，不要只填裸域名。">
                      <InputShell icon={Globe}>
                        <input value={draft.text.OPENAI_BASE_URL} onChange={(event) => updateDraft("text", (current) => ({ ...current, OPENAI_BASE_URL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://api.openai.com/v1" />
                      </InputShell>
                    </FieldGroup>
                    <div className="xl:col-span-2">{renderSecretField("API 密钥", draft.text.secret_state, textSecret, setTextSecret)}</div>
                  </div>
                ) : (
                  renderCreatePresetHint("文本模型")
                )}
              </SettingsSection>
            )}

            {activeTab === "vision" && (
              <SettingsSection
                icon={Globe}
                title="图片理解"
                description="关闭只影响运行时是否参与整理分析，不影响预设编辑、切换和连接测试。支持 OpenAI 兼容的多模态 Chat Completions 接口。"
                actions={
                  <div className="flex items-center gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleTest("vision")}
                      loading={testingFamily === "vision"}
                    >
                      测试多模态连接
                    </Button>
                    <div className="flex items-center gap-2 rounded-[10px] border border-on-surface/8 bg-surface-container-low px-3 py-2">
                      <span className="text-[12px] font-medium text-on-surface-variant/70">参与整理分析</span>
                      <ToggleSwitch
                        checked={Boolean(draft.global_config.IMAGE_ANALYSIS_ENABLED)}
                        onClick={() => updateGlobal("IMAGE_ANALYSIS_ENABLED", !draft.global_config.IMAGE_ANALYSIS_ENABLED)}
                      />
                    </div>
                  </div>
                }
              >
                <PresetSelector
                  label="图片理解预设"
                  presets={snapshot.families.vision.presets.map((item) => ({ id: item.id, name: item.name }))}
                  activeId={snapshot.families.vision.active_preset_id}
                  onSwitch={(id) => void handleActivatePreset("vision", id)}
                  onAdd={() => handleCreatePreset("vision")}
                  onDelete={(preset) => void handleDeletePreset("vision", preset.id, preset.name)}
                />
                {renderResult("vision")}
                <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-3">
                  <p className="text-[12px] font-semibold text-on-surface">支持的接口类型</p>
                  <p className="mt-1 text-[12px] leading-6 text-on-surface-variant/70">
                    适用于支持图片输入的 OpenAI 兼容聊天接口。测试时会发送一个极小图片探针，所以纯文本模型即使地址可达，也不会通过这里的图片理解测试。
                  </p>
                </div>
                {visionPresetEditable ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <FieldGroup label="模型 ID">
                      <InputShell icon={ImageIcon}>
                        <input value={draft.vision.IMAGE_ANALYSIS_MODEL} onChange={(event) => updateDraft("vision", (current) => ({ ...current, IMAGE_ANALYSIS_MODEL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none" placeholder="gpt-4o-mini" />
                      </InputShell>
                    </FieldGroup>
                    <FieldGroup label="接口地址" hint="建议填写到 /v1，并确保该模型支持图片输入。">
                      <InputShell icon={Globe}>
                        <input value={draft.vision.IMAGE_ANALYSIS_BASE_URL} onChange={(event) => updateDraft("vision", (current) => ({ ...current, IMAGE_ANALYSIS_BASE_URL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://host.example/v1" />
                      </InputShell>
                    </FieldGroup>
                    <div className="xl:col-span-2">{renderSecretField("图片理解密钥", draft.vision.secret_state, visionSecret, setVisionSecret)}</div>
                  </div>
                ) : (
                  renderCreatePresetHint("图片理解")
                )}
              </SettingsSection>
            )}

            {activeTab === "icon_image" && (
              <SettingsSection
                icon={ImageIcon}
                title="图标生成"
                description="这里配置图标预览生成模型。图标工坊会自动读取当前启用的文本预设，不需要单独设置文本密钥。"
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleTest("icon_image")}
                    loading={testingFamily === "icon_image"}
                  >
                    测试生图连接
                  </Button>
                }
              >
                <PresetSelector
                  label="图标生图预设"
                  presets={snapshot.families.icon_image.presets.map((item) => ({ id: item.id, name: item.name }))}
                  activeId={snapshot.families.icon_image.active_preset_id}
                  onSwitch={(id) => void handleActivatePreset("icon_image", id)}
                  onAdd={() => handleCreatePreset("icon_image")}
                  onDelete={(preset) => void handleDeletePreset("icon_image", preset.id, preset.name)}
                />
                {renderResult("icon_image")}
                <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-3">
                  <p className="text-[12px] font-semibold text-on-surface">支持的接口类型</p>
                  <p className="mt-1 text-[12px] leading-6 text-on-surface-variant/70">
                    适用于 OpenAI / DALL-E 风格的图片生成端点。接口地址可以填写到 <span className="font-mono text-on-surface">/v1</span>，也可以直接填写完整的
                    <span className="font-mono text-on-surface"> /images/generations</span> 端点。测试时只做最小化连通性探针，不会真的生成图片。
                  </p>
                </div>
                {iconImagePresetEditable ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <FieldGroup label="生图模型 ID">
                      <InputShell icon={Terminal}>
                        <input value={draft.icon_image.image_model.model} onChange={(event) => updateDraft("icon_image", (current) => ({ ...current, image_model: { ...current.image_model, model: event.target.value } }))} className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none" placeholder="gpt-image-1" />
                      </InputShell>
                    </FieldGroup>
                    <FieldGroup label="生图接口地址" className="xl:col-span-2" hint="可填写到 /v1，或直接填写完整 /images/generations 端点。">
                      <InputShell icon={Globe}>
                        <input value={draft.icon_image.image_model.base_url} onChange={(event) => updateDraft("icon_image", (current) => ({ ...current, image_model: { ...current.image_model, base_url: event.target.value } }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://host.example/v1" />
                      </InputShell>
                    </FieldGroup>
                    <FieldGroup label="图片尺寸" hint="默认值为 1024x1024。">
                      <div className="grid gap-3 md:grid-cols-3">
                        {IMAGE_SIZE_OPTIONS.map((size) => (
                          <StrategyOptionButton
                            key={size}
                            active={normalizeImageSize(draft.icon_image.image_size) === size}
                            label={size}
                            description={
                              size === "1024x1024"
                                ? "默认尺寸。"
                                : size === "512x512"
                                  ? "可选尺寸。"
                                  : "可选尺寸。"
                            }
                            onClick={() =>
                              updateDraft("icon_image", (current) => ({
                                ...current,
                                image_size: size,
                              }))
                            }
                          />
                        ))}
                      </div>
                    </FieldGroup>
                    <FieldGroup label="分析并发上限" hint="控制文件夹内容分析阶段的并发数，通常可以设得比生图更高。">
                      <InputShell icon={Cpu}>
                        <input
                          value={analysisConcurrencyInput}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            if (/^\d*$/.test(nextValue)) {
                              setAnalysisConcurrencyInput(nextValue);
                            }
                          }}
                          onBlur={commitAnalysisConcurrencyInput}
                          className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                          placeholder="1"
                          inputMode="numeric"
                        />
                      </InputShell>
                    </FieldGroup>
                    <FieldGroup label="生图并发上限" hint="控制图标预览生成阶段的并发数，建议保守设置，避免触发限流。">
                      <InputShell icon={Cpu}>
                        <input
                          value={imageConcurrencyInput}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            if (/^\d*$/.test(nextValue)) {
                              setImageConcurrencyInput(nextValue);
                            }
                          }}
                          onBlur={commitImageConcurrencyInput}
                          className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                          placeholder="1"
                          inputMode="numeric"
                        />
                      </InputShell>
                    </FieldGroup>
                    <FieldGroup label="保存方式" className="xl:col-span-2">
                      <div className="grid gap-3 md:grid-cols-2">
                        <StrategyOptionButton active={draft.icon_image.save_mode === "centralized"} label="集中保存" onClick={() => updateDraft("icon_image", (current) => ({ ...current, save_mode: "centralized" }))} description="图标资源集中写入统一目录，便于管理版本与回看。" />
                        <StrategyOptionButton active={draft.icon_image.save_mode === "in_folder"} label="就地保存" onClick={() => updateDraft("icon_image", (current) => ({ ...current, save_mode: "in_folder" }))} description="处理后资源靠近目标文件夹，适合边做边核对。" />
                      </div>
                    </FieldGroup>
                    <div className="xl:col-span-2">{renderSecretField("生图接口密钥", draft.icon_image.image_model.secret_state, iconSecret, setIconSecret)}</div>
                  </div>
                ) : (
                  renderCreatePresetHint("图标生图")
                )}
              </SettingsSection>
            )}

            {activeTab === "bg_removal" && (
              <SettingsSection
                icon={Scissors}
                title="背景处理"
                description="桌面端图标工坊会读取这里的背景处理配置。可使用内置预设，也可切换为自定义服务。"
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleTest("bg_removal")}
                    loading={testingFamily === "bg_removal"}
                    disabled={!desktopReady}
                  >
                    {desktopReady ? "测试抠图连接" : "仅桌面端可测试"}
                  </Button>
                }
              >
                <FieldGroup label="服务模式">
                  <div className="grid gap-3 md:grid-cols-2">
                    <StrategyOptionButton
                      active={draft.bg_removal.mode === "preset"}
                      label="使用内置预设"
                      description="直接使用内置的背景处理服务，适合快速开始。"
                      onClick={() => updateDraft("bg_removal", (current) => ({ ...current, mode: "preset" }))}
                    />
                    <StrategyOptionButton
                      active={draft.bg_removal.mode === "custom"}
                      label="自定义服务"
                      description="手动填写 Space ID、API 类型和 payload_template。"
                      onClick={() => updateDraft("bg_removal", (current) => ({ ...current, mode: "custom" }))}
                    />
                  </div>
                </FieldGroup>
                {renderResult("bg_removal")}
                <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-3">
                  <p className="text-[12px] font-semibold text-on-surface">当前执行约束</p>
                  <p className="mt-1 text-[12px] leading-6 text-on-surface-variant/70">
                    抠图测试与正式执行都走桌面端 Tauri。Web 环境只能编辑和保存配置，不能直接测试连接。
                  </p>
                </div>

                {draft.bg_removal.mode === "preset" ? (
                  <FieldGroup label="内置预设">
                    <div className="grid gap-3 xl:grid-cols-2">
                      {snapshot.families.bg_removal.builtin_presets.map((preset) => (
                        <StrategyOptionButton
                          key={preset.id}
                          active={draft.bg_removal.preset_id === preset.id}
                          label={preset.name}
                          description={`${preset.model_id} · ${preset.api_type}`}
                          onClick={() => updateDraft("bg_removal", (current) => ({ ...current, preset_id: preset.id }))}
                        />
                      ))}
                    </div>
                  </FieldGroup>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <FieldGroup label="自定义名称">
                      <InputShell icon={Cpu}>
                        <input
                          value={draft.bg_removal.custom.name}
                          onChange={(event) =>
                            updateDraft("bg_removal", (current) => ({
                              ...current,
                              custom: { ...current.custom, name: event.target.value },
                            }))
                          }
                          className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                          placeholder="自定义抠图"
                        />
                      </InputShell>
                    </FieldGroup>
                    <FieldGroup label="Space / Model ID">
                      <InputShell icon={Terminal}>
                        <input
                          value={draft.bg_removal.custom.model_id}
                          onChange={(event) =>
                            updateDraft("bg_removal", (current) => ({
                              ...current,
                              custom: { ...current.custom, model_id: event.target.value },
                            }))
                          }
                          className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none"
                          placeholder="user/space-name"
                        />
                      </InputShell>
                    </FieldGroup>
                    <FieldGroup label="API 类型">
                      <InputShell icon={Globe}>
                        <input
                          value={draft.bg_removal.custom.api_type}
                          onChange={(event) =>
                            updateDraft("bg_removal", (current) => ({
                              ...current,
                              custom: { ...current.custom, api_type: event.target.value },
                            }))
                          }
                          className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                          placeholder="gradio_space"
                        />
                      </InputShell>
                    </FieldGroup>
                    <FieldGroup label="Payload Template" className="xl:col-span-2" hint="填写原始 JSON 文本，可使用 {{uploaded_path}} 与 {{model_id}} 占位符。">
                      <textarea
                        value={draft.bg_removal.custom.payload_template}
                        onChange={(event) =>
                          updateDraft("bg_removal", (current) => ({
                            ...current,
                            custom: { ...current.custom, payload_template: event.target.value },
                          }))
                        }
                        className="min-h-32 w-full resize-y rounded-[10px] border border-on-surface/8 bg-white px-4 py-3 font-mono text-[13px] leading-6 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary focus:ring-4 focus:ring-primary/5"
                        placeholder='{"data":[{"path":"{{uploaded_path}}","meta":{"_type":"gradio.FileData"}}],"fn_index":0}'
                      />
                    </FieldGroup>
                  </div>
                )}

                {renderSecretField("Hugging Face Token（可选）", draft.bg_removal.custom.secret_state, bgRemovalSecret, setBgRemovalSecret)}
              </SettingsSection>
            )}

            {activeTab === "launch" && (
              <SettingsSection
                icon={SettingsIcon}
                title="新任务默认值"
                description="这些值会作为首页默认预设和启动配置的初始值。"
              >
                <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">{launchTemplate.label}</span>
                    <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">{draft.global_config.LAUNCH_DEFAULT_NAMING_STYLE}</span>
                    <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">{draft.global_config.LAUNCH_DEFAULT_CAUTION_LEVEL}</span>
                  </div>
                  <p className="mt-3 text-[13px] leading-6 text-on-surface-variant/70">保存后，首页“当前预设”和新任务启动流程会立即读取这些值。</p>
                </div>
                <FieldGroup label="默认模板">
                  <div className="grid gap-3 xl:grid-cols-2">
                    {STRATEGY_TEMPLATES.map((template) => (
                      <StrategyOptionButton
                        key={template.id}
                        active={draft.global_config.LAUNCH_DEFAULT_TEMPLATE_ID === template.id}
                        label={template.label}
                        description={template.description}
                        onClick={() => {
                          const suggested = getSuggestedSelection(template.id);
                          updateGlobal("LAUNCH_DEFAULT_TEMPLATE_ID", template.id);
                          updateGlobal("LAUNCH_DEFAULT_NAMING_STYLE", suggested.naming_style);
                          updateGlobal("LAUNCH_DEFAULT_CAUTION_LEVEL", suggested.caution_level);
                        }}
                      />
                    ))}
                  </div>
                </FieldGroup>
                <div className="grid gap-4 xl:grid-cols-2">
                  <FieldGroup label="命名风格">
                    <div className="grid gap-3">
                      {NAMING_STYLE_OPTIONS.map((option) => (
                        <StrategyOptionButton key={option.id} active={draft.global_config.LAUNCH_DEFAULT_NAMING_STYLE === option.id} label={option.label} description={option.description} onClick={() => updateGlobal("LAUNCH_DEFAULT_NAMING_STYLE", option.id)} />
                      ))}
                    </div>
                  </FieldGroup>
                  <FieldGroup label="整理方式">
                    <div className="grid gap-3">
                      {CAUTION_LEVEL_OPTIONS.map((option) => (
                        <StrategyOptionButton key={option.id} active={draft.global_config.LAUNCH_DEFAULT_CAUTION_LEVEL === option.id} label={option.label} description={option.description} onClick={() => updateGlobal("LAUNCH_DEFAULT_CAUTION_LEVEL", option.id)} />
                      ))}
                    </div>
                  </FieldGroup>
                  <FieldGroup label="补充说明" className="xl:col-span-2">
                    <textarea
                      value={draft.global_config.LAUNCH_DEFAULT_NOTE ?? ""}
                      onChange={(event) => updateGlobal("LAUNCH_DEFAULT_NOTE", event.target.value.slice(0, 200))}
                      className="min-h-28 w-full resize-none rounded-[10px] border border-on-surface/8 bg-white px-4 py-3 text-[14px] leading-7 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary focus:ring-4 focus:ring-primary/5"
                      placeholder="例如：拿不准的先放 Review，课程资料尽量按学期整理。"
                    />
                  </FieldGroup>
                </div>
                <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-3.5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-[13px] font-semibold text-on-surface">直接使用默认值启动</h3>
                      <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">开启后，首页点击开始时会直接按默认配置进入任务，不再额外弹出策略确认。</p>
                    </div>
                    <ToggleSwitch checked={Boolean(draft.global_config.LAUNCH_SKIP_STRATEGY_PROMPT)} onClick={() => updateGlobal("LAUNCH_SKIP_STRATEGY_PROMPT", !draft.global_config.LAUNCH_SKIP_STRATEGY_PROMPT)} />
                  </div>
                </div>
              </SettingsSection>
            )}

            {activeTab === "system" && (
              <SettingsSection
                icon={ShieldCheck}
                title="运行与日志"
                description="只保留常用的运行和日志开关，避免把这里变成调试控制台。"
              >
                <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-3.5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-[13px] font-semibold text-on-surface">详细日志</h3>
                      <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">关闭时保留基础运行日志；开启后会额外输出更详细的调试记录。</p>
                    </div>
                    <ToggleSwitch checked={Boolean(draft.global_config.DEBUG_MODE)} onClick={() => updateGlobal("DEBUG_MODE", !draft.global_config.DEBUG_MODE)} />
                  </div>
                </div>
              </SettingsSection>
            )}
          </div>
        </main>
      </div>

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
                  if (!dialog) {
                    return;
                  }
                  setCreatePresetDialog(null);
                  await performCreatePreset(dialog.family, dialog.value);
                })();
              }
            }}
            className="w-full rounded-[10px] border border-on-surface/8 bg-white px-4 py-3 text-[14px] font-semibold text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary focus:ring-4 focus:ring-primary/5"
            placeholder="例如：Tongyi 生图备用"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deletePresetDialog)}
        title="删除预设"
        description={deletePresetDialog ? `确定删除“${deletePresetDialog.presetName}”吗？删除后不能恢复。` : ""}
        confirmLabel="确认删除"
        cancelLabel="取消"
        tone="danger"
        loading={loading}
        onConfirm={async () => {
          if (!deletePresetDialog) {
            return;
          }
           const dialog = deletePresetDialog;
          setDeletePresetDialog(null);
          await performDeletePreset(dialog.family, dialog.presetId);
        }}
        onCancel={() => setDeletePresetDialog(null)}
      />

      <ConfirmDialog
        open={Boolean(switchPresetDialog)}
        title="切换预设并放弃草稿？"
        description="当前页面有未保存修改。继续切换会丢失这批草稿内容。"
        confirmLabel="放弃并切换"
        cancelLabel="继续编辑"
        loading={loading}
        onConfirm={async () => {
          if (!switchPresetDialog) {
            return;
          }
           const dialog = switchPresetDialog;
          setSwitchPresetDialog(null);
          await performActivatePreset(dialog.family, dialog.presetId);
        }}
        onCancel={() => setSwitchPresetDialog(null)}
      />
    </div>
  );
}
