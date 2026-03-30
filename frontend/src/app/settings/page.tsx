"use client";

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
import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
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

type DraftState = {
  global_config: SettingsSnapshot["global_config"];
  text: TextSettingsPreset;
  vision: VisionSettingsPreset;
  icon_image: SettingsSnapshot["families"]["icon_image"]["active_preset"];
};

type CreatePresetDialogState = {
  family: SettingsFamily;
  value: string;
};

type DeletePresetDialogState = {
  family: SettingsFamily;
  presetId: string;
  presetName: string;
};

type SwitchPresetDialogState = {
  family: SettingsFamily;
  presetId: string;
};

const APP_CONTEXT_EVENT = "file-organizer-context-change";
const SETTINGS_CONTEXT_KEY = "settings_header_context";

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createSecretDraft(): SecretDraft {
  return { action: "keep", value: "", visible: false };
}

function snapshotToDraft(snapshot: SettingsSnapshot): DraftState {
  return {
    global_config: cloneValue(snapshot.global_config),
    text: cloneValue(snapshot.families.text.active_preset),
    vision: cloneValue(snapshot.families.vision.active_preset),
    icon_image: cloneValue(snapshot.families.icon_image.active_preset),
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

function buildFingerprint(draft: DraftState | null, secrets: Record<SettingsFamily, SecretDraft>) {
  if (!draft) {
    return "";
  }
  return JSON.stringify({
    draft,
    secrets: {
      text: { action: secrets.text.action, value: secrets.text.value },
      vision: { action: secrets.vision.action, value: secrets.vision.value },
      icon_image: { action: secrets.icon_image.action, value: secrets.icon_image.value },
    },
  });
}

export default function SettingsPage() {
  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);
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
  const [baseline, setBaseline] = useState("");
  const [createPresetDialog, setCreatePresetDialog] = useState<CreatePresetDialogState | null>(null);
  const [deletePresetDialog, setDeletePresetDialog] = useState<DeletePresetDialogState | null>(null);
  const [switchPresetDialog, setSwitchPresetDialog] = useState<SwitchPresetDialogState | null>(null);

  const secretMap = useMemo(
    () => ({
      text: textSecret,
      vision: visionSecret,
      icon_image: iconSecret,
    }),
    [iconSecret, textSecret, visionSecret],
  );

  const isDirty = useMemo(() => buildFingerprint(draft, secretMap) !== baseline, [baseline, draft, secretMap]);

  const hydrate = (nextSnapshot: SettingsSnapshot) => {
    const nextDraft = snapshotToDraft(nextSnapshot);
    const emptySecrets = {
      text: createSecretDraft(),
      vision: createSecretDraft(),
      icon_image: createSecretDraft(),
    };
    setSnapshot(nextSnapshot);
    setDraft(nextDraft);
    setTextSecret(emptySecrets.text);
    setVisionSecret(emptySecrets.vision);
    setIconSecret(emptySecrets.icon_image);
    setBaseline(buildFingerprint(nextDraft, emptySecrets));
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
        detail: "统一配置内核",
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

  const performActivatePreset = async (family: SettingsFamily, presetId: string) => {
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

  const handleActivatePreset = async (family: SettingsFamily, presetId: string) => {
    if (isDirty) {
      setSwitchPresetDialog({ family, presetId });
      return;
    }
    await performActivatePreset(family, presetId);
  };

  const performCreatePreset = async (family: SettingsFamily, presetName: string) => {
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
            name: draft.text.name,
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
            name: draft.vision.name,
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
            name: draft.icon_image.name,
            image_model: {
              base_url: draft.icon_image.image_model.base_url,
              model: draft.icon_image.image_model.model,
            },
            image_size: draft.icon_image.image_size,
            concurrency_limit: draft.icon_image.concurrency_limit,
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

  const handleCreatePreset = (family: SettingsFamily) => {
    setCreatePresetDialog({
      family,
      value: family === "text" ? "新的文本预设" : family === "vision" ? "新的图片理解预设" : "新的图标生图预设",
    });
  };

  const performDeletePreset = async (family: SettingsFamily, presetId: string) => {
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

  const handleDeletePreset = (family: SettingsFamily, presetId: string, presetName: string) => {
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
          preset: {
            name: draft.text.name,
            OPENAI_BASE_URL: draft.text.OPENAI_BASE_URL,
            OPENAI_MODEL: draft.text.OPENAI_MODEL,
          },
          secret: buildSecretPayload(textSecret),
        },
        vision: {
          enabled: Boolean(draft.global_config.IMAGE_ANALYSIS_ENABLED),
          preset: {
            name: draft.vision.name,
            IMAGE_ANALYSIS_NAME: draft.vision.IMAGE_ANALYSIS_NAME,
            IMAGE_ANALYSIS_BASE_URL: draft.vision.IMAGE_ANALYSIS_BASE_URL,
            IMAGE_ANALYSIS_MODEL: draft.vision.IMAGE_ANALYSIS_MODEL,
          },
          secret: buildSecretPayload(visionSecret),
        },
        icon_image: {
          preset: {
            name: draft.icon_image.name,
            image_model: {
              base_url: draft.icon_image.image_model.base_url,
              model: draft.icon_image.image_model.model,
            },
            image_size: draft.icon_image.image_size,
            concurrency_limit: draft.icon_image.concurrency_limit,
            save_mode: draft.icon_image.save_mode,
          },
          secret: buildSecretPayload(iconSecret),
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
      setSuccess("设置已原子保存，三类配置已一起生效");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (family: SettingsFamily) => {
    if (!draft) {
      return;
    }
    setTestingFamily(family);
    setError(null);
    try {
      const result =
        family === "text"
          ? await api.testSettings({
              family,
              preset: {
                name: draft.text.name,
                OPENAI_BASE_URL: draft.text.OPENAI_BASE_URL,
                OPENAI_MODEL: draft.text.OPENAI_MODEL,
              },
              secret: buildSecretPayload(textSecret),
            })
          : family === "vision"
            ? await api.testSettings({
                family,
                preset: {
                  name: draft.vision.name,
                  IMAGE_ANALYSIS_NAME: draft.vision.IMAGE_ANALYSIS_NAME,
                  IMAGE_ANALYSIS_BASE_URL: draft.vision.IMAGE_ANALYSIS_BASE_URL,
                  IMAGE_ANALYSIS_MODEL: draft.vision.IMAGE_ANALYSIS_MODEL,
                },
                secret: buildSecretPayload(visionSecret),
              })
            : await api.testSettings({
                family,
                preset: {
                  name: draft.icon_image.name,
                  image_model: {
                    base_url: draft.icon_image.image_model.base_url,
                    model: draft.icon_image.image_model.model,
                  },
                  image_size: draft.icon_image.image_size,
                  concurrency_limit: draft.icon_image.concurrency_limit,
                  save_mode: draft.icon_image.save_mode,
                },
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
    if (!result) {
      return null;
    }
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-[10px] border px-4 py-3 text-[12px] font-medium",
          result.status === "ok"
            ? "border-emerald-500/12 bg-emerald-500/5 text-emerald-700"
            : "border-error/12 bg-error/5 text-error",
        )}
      >
        {result.status === "ok" ? <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-4.5 w-4.5 shrink-0" />}
        <div className="space-y-1">
          <p>{result.message}</p>
          {result.status !== "ok" ? <p className="text-[11px] opacity-70">错误分类：{result.code}</p> : null}
        </div>
      </div>
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
                "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                state === "stored" ? "border border-primary/12 bg-primary/8 text-primary" : "border border-on-surface/8 bg-surface-container-low text-on-surface-variant",
              )}>
                {state === "stored" ? "已保存" : "未保存"}
              </span>
              {secret.action === "replace" && secret.value.trim() ? (
                <span className="rounded-full border border-emerald-500/12 bg-emerald-500/5 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">待替换</span>
              ) : null}
              {secret.action === "clear" ? (
                <span className="rounded-full border border-error/12 bg-error/5 px-2.5 py-1 text-[11px] font-semibold text-error">待清空</span>
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
        <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-3 py-2">
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

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-surface">
      <main className="ui-page flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5">
          <section className="sticky top-0 z-20 overflow-hidden rounded-[12px] border border-on-surface/8 bg-surface-container-lowest shadow-[0_18px_44px_rgba(0,0,0,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-on-surface/6 bg-surface px-5 py-4">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ui-muted">
                  <SettingsIcon className="h-3.5 w-3.5" />
                  Settings Core
                </div>
                <div className="space-y-1">
                  <h1 className="text-[1.35rem] font-black tracking-tight text-on-surface">统一设置与安全收口</h1>
                  <p className="max-w-[760px] text-[13px] leading-6 text-on-surface-variant/70">
                    文本模型、图片理解和图标生图现在共用一个真实配置源。保存时会一次性原子提交，不会出现半保存状态。
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-low px-3 py-2 text-[12px] text-on-surface-variant/70">
                  文本 {snapshot.status.text_configured ? "已配置" : "未配置"} / 图片理解 {snapshot.status.vision_configured ? "已配置" : "未配置"} / 图标生图 {snapshot.status.icon_image_configured ? "已配置" : "未配置"}
                </div>
                <Button variant="secondary" onClick={() => hydrate(snapshot)} disabled={!isDirty}>
                  放弃草稿
                </Button>
                <Button onClick={() => void handleSave()} loading={saving} disabled={!isDirty || saving}>
                  保存全部设置
                </Button>
              </div>
            </div>
            {error ? <div className="px-4 py-3"><ErrorAlert title="设置保存失败" message={error} onClose={() => setError(null)} /></div> : null}
            {success ? (
              <div className="flex items-center gap-3 border-t border-emerald-500/10 bg-emerald-500/5 px-5 py-3 text-[12px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-4.5 w-4.5" />
                {success}
              </div>
            ) : null}
          </section>

          <SettingsSection
            icon={Layers3}
            title="文本模型"
            description="扫描、规划和图标工坊文案都动态读取当前激活的文本预设，不再依赖模块级缓存。支持 OpenAI 兼容的 Chat Completions 接口。"
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
            <div className="grid gap-4 xl:grid-cols-2">
              <FieldGroup label="预设名称">
                <InputShell icon={Cpu}>
                  <input value={draft.text.name} onChange={(event) => updateDraft("text", (current) => ({ ...current, name: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none" placeholder="默认文本模型" />
                </InputShell>
              </FieldGroup>
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
          </SettingsSection>

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
            <div className="grid gap-4 xl:grid-cols-2">
              <FieldGroup label="预设名称">
                <InputShell icon={Cpu}>
                  <input value={draft.vision.name} onChange={(event) => updateDraft("vision", (current) => ({ ...current, name: event.target.value, IMAGE_ANALYSIS_NAME: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none" placeholder="默认图片模型" />
                </InputShell>
              </FieldGroup>
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
          </SettingsSection>

          <SettingsSection
            icon={ImageIcon}
            title="图标工坊生图"
            description="这里只保存生图模型本身；图标工坊运行时会自动引用当前激活的文本预设，不再额外持久化全局文本密钥。支持 OpenAI / DALL-E 风格的图片生成接口。"
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
              <FieldGroup label="图片尺寸">
                <InputShell icon={Layers3}>
                  <input value={draft.icon_image.image_size} onChange={(event) => updateDraft("icon_image", (current) => ({ ...current, image_size: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none" placeholder="1024x1024" />
                </InputShell>
              </FieldGroup>
              <FieldGroup label="并发上限">
                <InputShell icon={Cpu}>
                  <input value={String(draft.icon_image.concurrency_limit)} onChange={(event) => updateDraft("icon_image", (current) => ({ ...current, concurrency_limit: Math.max(1, Number(event.target.value || 1)) || 1 }))} className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none" placeholder="1" />
                </InputShell>
              </FieldGroup>
              <FieldGroup label="保存方式" className="xl:col-span-2">
                <div className="grid gap-3 md:grid-cols-2">
                  <StrategyOptionButton active={draft.icon_image.save_mode === "centralized"} label="集中保存" description="图标资源集中写入统一目录，便于管理版本与回看。" onClick={() => updateDraft("icon_image", (current) => ({ ...current, save_mode: "centralized" }))} />
                  <StrategyOptionButton active={draft.icon_image.save_mode === "in_folder"} label="就地保存" description="处理后资源靠近目标文件夹，适合边做边核对。" onClick={() => updateDraft("icon_image", (current) => ({ ...current, save_mode: "in_folder" }))} />
                </div>
              </FieldGroup>
              <div className="xl:col-span-2">{renderSecretField("生图接口密钥", draft.icon_image.image_model.secret_state, iconSecret, setIconSecret)}</div>
            </div>
          </SettingsSection>

          <SettingsSection
            icon={SettingsIcon}
            title="新任务启动默认值"
            description="这些值会作为首页默认策略和启动弹窗的预填起点。"
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

          <SettingsSection
            icon={ShieldCheck}
            title="运行与调试"
            description="保留少量全局开关，不把设置页扩展成调试控制台。"
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
        </div>
      </main>

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
