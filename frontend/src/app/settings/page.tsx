"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Edit3,
  Eye,
  EyeOff,
  Globe,
  Layers3,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { createApiClient } from "@/lib/api";
import { createIconWorkbenchApiClient } from "@/lib/icon-workbench-api";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import {
  CAUTION_LEVEL_OPTIONS,
  getSuggestedSelection,
  getTemplateMeta,
  NAMING_STYLE_OPTIONS,
  STRATEGY_TEMPLATES,
} from "@/lib/strategy-templates";
import { cn } from "@/lib/utils";
import type { IconWorkbenchConfig } from "@/types/icon-workbench";
import {
  FieldGroup,
  InputShell,
  PresetManager,
  SettingsSection,
  StrategyOptionButton,
  ToggleSwitch,
  type PresetItem,
} from "@/components/settings/settings-primitives";

type PresetType = "text" | "vision";
type SettingsCategory = "models" | "launch" | "advanced";

interface DialogState {
  type: "prompt" | "confirm";
  title: string;
  message: string;
  value?: string;
  onConfirm: (value?: string) => void;
}

const SETTINGS_CATEGORIES: Array<{
  id: SettingsCategory;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: "models",
    label: "模型配置",
    description: "文本与图片模型预设",
    icon: Layers3,
  },
  {
    id: "launch",
    label: "启动默认值",
    description: "新任务启动策略",
    icon: SettingsIcon,
  },
  {
    id: "advanced",
    label: "其他设置",
    description: "日志与少量开关",
    icon: ShieldCheck,
  },
];

export default function SettingsPage() {
  const APP_CONTEXT_EVENT = "file-organizer-context-change";
  const SETTINGS_CONTEXT_KEY = "settings_header_context";
  const [api] = useState(() => createApiClient(getApiBaseUrl(), getApiToken()));
  const [iconApi] = useState(() => createIconWorkbenchApiClient(getApiBaseUrl(), getApiToken()));
  const [config, setConfig] = useState<any>(null);
  const [originalConfig, setOriginalConfig] = useState<any>(null);
  const [iconConfig, setIconConfig] = useState<IconWorkbenchConfig | null>(null);
  const [originalIconConfig, setOriginalIconConfig] = useState<IconWorkbenchConfig | null>(null);
  const [textPresets, setTextPresets] = useState<PresetItem[]>([]);
  const [visionPresets, setVisionPresets] = useState<PresetItem[]>([]);
  const [activeTextPresetId, setActiveTextPresetId] = useState("default");
  const [activeVisionPresetId, setActiveVisionPresetId] = useState("default");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testVision, setTestVision] = useState(false);
  const [testIconImage, setTestIconImage] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("models");

  const [testResult, setTestResult] = useState<{ type: string; status: "success" | "error"; message: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showVisionKey, setShowVisionKey] = useState(false);
  const [showIconImageKey, setShowIconImageKey] = useState(false);
  const [textEditorExpanded, setTextEditorExpanded] = useState(true);
  const [visionEditorExpanded, setVisionEditorExpanded] = useState(true);

  const isDirty = Boolean(
    (config && originalConfig && JSON.stringify(config) !== JSON.stringify(originalConfig))
      || (iconConfig && originalIconConfig && JSON.stringify(iconConfig) !== JSON.stringify(originalIconConfig)),
  );
  const launchTemplate = getTemplateMeta(config?.LAUNCH_DEFAULT_TEMPLATE_ID ?? "general_downloads");

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [data, nextIconConfig] = await Promise.all([api.getConfig(), iconApi.getConfig()]);
      setConfig(data.config);
      setOriginalConfig(data.config);
      setIconConfig(nextIconConfig);
      setOriginalIconConfig(nextIconConfig);
      setTextPresets(data.text_presets);
      setVisionPresets(data.vision_presets);
      setActiveTextPresetId(data.active_text_preset_id);
      setActiveVisionPresetId(data.active_vision_preset_id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const currentCategory = SETTINGS_CATEGORIES.find((item) => item.id === activeCategory);
    window.localStorage.setItem(
      SETTINGS_CONTEXT_KEY,
      JSON.stringify({
        title: "设置",
        detail: currentCategory?.label || "模型配置",
      }),
    );
    window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
  }, [APP_CONTEXT_EVENT, SETTINGS_CONTEXT_KEY, activeCategory]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!saving && !loading && isDirty) {
          void handleSave();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, isDirty, loading, saving]);

  const handleChange = (key: string, value: any) => {
    setConfig((prev: any) => ({ ...prev, [key]: value }));
    setSuccess(null);
    setTestResult(null);
  };

  const handleLaunchTemplateChange = (templateId: string) => {
    const suggested = getSuggestedSelection(templateId as any);
    setConfig((prev: any) => ({
      ...prev,
      LAUNCH_DEFAULT_TEMPLATE_ID: templateId,
      LAUNCH_DEFAULT_NAMING_STYLE: suggested.naming_style,
      LAUNCH_DEFAULT_CAUTION_LEVEL: suggested.caution_level,
    }));
    setSuccess(null);
  };

  async function handleSave() {
    if (!iconConfig) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const [, savedIconConfig] = await Promise.all([api.updateConfig(config), iconApi.updateConfig(iconConfig)]);
      setIconConfig(savedIconConfig);
      setOriginalIconConfig(savedIconConfig);
      setSuccess("设置已保存");
      setOriginalConfig(config);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const handleTest = async (type: "text" | "vision" | "icon_image") => {
    if (type === "text") {
      setTesting(true);
    } else if (type === "vision") {
      setTestVision(true);
    } else {
      setTestIconImage(true);
    }
    setTestResult(null);
    try {
      const payload = type === "icon_image" 
        ? { test_type: "icon_image", ICON_IMAGE_API_KEY: iconConfig?.image_model.api_key, ICON_IMAGE_BASE_URL: iconConfig?.image_model.base_url, ICON_IMAGE_MODEL: iconConfig?.image_model.model }
        : { ...config, test_type: type };
      const data = await api.testLlm(payload);
      setTestResult({
        type,
        status: data.status === "ok" ? "success" : "error",
        message: data.message,
      });
    } catch (err: any) {
      setTestResult({
        type,
        status: "error",
        message: err?.message || "连通性测试失败，请检查本地网络或服务端点",
      });
    } finally {
      setTesting(false);
      setTestVision(false);
      setTestIconImage(false);
    }
  };

  const performSwitchPreset = async (presetType: PresetType, id: string) => {
    setDialog(null);
    setLoading(true);
    setError(null);
    try {
      await api.switchPreset(presetType, id);
      await fetchAll();
      setSuccess(`${presetType === "text" ? "文本" : "图片"}预设已切换`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleSwitchPreset = (presetType: PresetType, id: string) => {
    const currentId = presetType === "text" ? activeTextPresetId : activeVisionPresetId;
    if (currentId === id) {
      return;
    }
    if (isDirty) {
      setDialog({
        type: "confirm",
        title: "放弃未保存修改？",
        message: "切换预设后，当前未保存的修改会丢失。",
        onConfirm: () => {
          void performSwitchPreset(presetType, id);
        },
      });
      return;
    }
    void performSwitchPreset(presetType, id);
  };

  const handleAddPreset = (presetType: PresetType) => {
    setDialog({
      type: "prompt",
      title: `新建${presetType === "text" ? "文本" : "图片"}预设`,
      message: "输入一个便于识别的预设名称。",
      value: presetType === "text" ? "新的文本预设" : "新的图片预设",
      onConfirm: async (value) => {
        const name = String(value || "").trim();
        if (!name) {
          return;
        }
        setDialog(null);
        setLoading(true);
        setError(null);
        try {
          await api.addPreset(presetType, name, true);
          await fetchAll();
          setSuccess(`${presetType === "text" ? "文本" : "图片"}预设已创建`);
          setTimeout(() => setSuccess(null), 3000);
        } catch (err: any) {
          setError(err.message);
          setLoading(false);
        }
      },
    });
  };

  const handleDeletePreset = (presetType: PresetType, preset: PresetItem) => {
    setDialog({
      type: "confirm",
      title: "确认删除预设？",
      message: `确定删除“${preset.name}”吗？删除后不能恢复。`,
      onConfirm: async () => {
        setDialog(null);
        setLoading(true);
        setError(null);
        try {
          await api.deletePreset(presetType, preset.id);
          await fetchAll();
          setSuccess(`${presetType === "text" ? "文本" : "图片"}预设已删除`);
          setTimeout(() => setSuccess(null), 3000);
        } catch (err: any) {
          setError(err.message);
          setLoading(false);
        }
      },
    });
  };

  if (loading || !config || !iconConfig) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-5">
          <RefreshCw className="h-9 w-9 animate-spin text-primary/40" />
          <p className="text-[12px] font-medium text-on-surface-variant/55">正在读取设置</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-surface">
      <main className="min-w-0 flex-1 overflow-y-auto bg-surface">
        <div className="ui-page flex flex-col gap-5">
          <div className="ui-page-header glass-surface sticky top-0 z-20 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-[1.35rem] font-black tracking-tight text-on-surface">设置与偏好</h1>
                  {isDirty ? (
                    <span className="rounded-[8px] border border-warning/10 bg-warning-container/20 px-2.5 py-1 text-[12px] font-medium text-warning">
                      未保存
                    </span>
                  ) : null}
                </div>
                <p className="max-w-[760px] text-[13px] leading-6 text-on-surface-variant/70">
                  文本模型和图片理解模型都可以按「预设」保存并快速切换。其中，“图标工坊”会直接复用这里配置的文本能力，但也支持为绘图单独配置图像模型。
                </p>
              </div>

              <div className="flex items-center gap-3">
                <AnimatePresence>
                  {success ? (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="flex items-center gap-2 rounded-[8px] border border-emerald-500/10 bg-emerald-500/5 px-3 py-2 text-[12px] font-medium text-emerald-700"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {success}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                <Button
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  loading={saving}
                  variant={isDirty ? "primary" : "secondary"}
                  className="px-6 py-3 text-sm"
                >
                  {saving ? "保存中" : "保存更改"}
                </Button>
              </div>
            </div>
          </div>

          {error ? <ErrorAlert title="设置操作失败" message={error} /> : null}

          <div className="grid gap-5 grid-cols-[248px_minmax(0,1fr)]">
            <aside className="sticky top-[84px] h-fit space-y-3">
              <div>
                <div className="flex flex-col gap-2">
                  {SETTINGS_CATEGORIES.map((category) => {
                    const Icon = category.icon;
                    const active = activeCategory === category.id;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setActiveCategory(category.id)}
                        className={cn(
                          "rounded-[8px] border px-4 py-3 text-left transition-colors",
                          active
                            ? "border-primary/18 bg-primary/7"
                            : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/14",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border",
                              active
                                ? "border-primary/12 bg-primary/10 text-primary"
                                : "border-on-surface/8 bg-surface-container-low text-on-surface-variant/55",
                            )}
                          >
                            <Icon className="h-4.5 w-4.5" />
                          </div>
                          <div className="space-y-1">
                            <p className={cn("text-[13px] font-semibold tracking-tight", active ? "text-on-surface" : "text-on-surface-variant/80")}>
                              {category.label}
                            </p>
                            <p className="text-[12px] leading-5 text-on-surface-variant/60">{category.description}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>

            <div className="space-y-5">
              {activeCategory === "models" ? (
                <>
                  <SettingsSection
                    icon={Cpu}
                    title="文本模型设置"
                    description="集中管理目录分析、整理对话等基础特性所在的模型与密钥，支持配置多套预设方便快捷切换。"
                    actions={
                      <Button
                        onClick={() => void handleTest("text")}
                        disabled={testing}
                        loading={testing}
                        variant="secondary"
                        size="sm"
                        className="px-5 py-2.5"
                      >
                        测试文本能力
                      </Button>
                    }
                  >
                    <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-low px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-[12px] font-medium text-on-surface-variant/60">当前激活文本预设</p>
                          <p className="text-[14px] font-semibold text-on-surface">{textPresets.find((preset) => preset.id === activeTextPresetId)?.name || "默认文本模型"}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTextEditorExpanded((current) => !current)}
                          className="inline-flex items-center gap-2 rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-3 py-1.5 text-[12px] font-medium text-on-surface-variant transition-colors hover:text-on-surface"
                        >
                          {textEditorExpanded ? "收起编辑区" : "展开编辑区"}
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", textEditorExpanded && "rotate-180")} />
                        </button>
                      </div>
                    </div>

                    <PresetManager
                      title="文本预设"
                      presets={textPresets}
                      activeId={activeTextPresetId}
                      onSwitch={(id) => handleSwitchPreset("text", id)}
                      onAdd={() => handleAddPreset("text")}
                      onDelete={(preset) => handleDeletePreset("text", preset)}
                    />

                    {testResult?.type === "text" ? (
                      <div
                        className={cn(
                          "flex items-center gap-3 rounded-[10px] border px-4 py-3 text-[12px] font-medium",
                          testResult.status === "success"
                            ? "border-emerald-500/10 bg-emerald-500/5 text-emerald-700"
                            : "border-error/10 bg-error/5 text-error",
                        )}
                      >
                        {testResult.status === "success" ? (
                          <CheckCircle2 className="h-4.5 w-4.5 shrink-0" />
                        ) : (
                          <AlertCircle className="h-4.5 w-4.5 shrink-0" />
                        )}
                        <p>{testResult.message}</p>
                      </div>
                    ) : null}

                    {textEditorExpanded ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                      <FieldGroup label="文本预设名称" className="xl:col-span-2">
                        <InputShell icon={Edit3}>
                          <input
                            value={config.name}
                            onChange={(event) => handleChange("name", event.target.value)}
                            className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                            placeholder="例如：OpenAI 主链路"
                          />
                        </InputShell>
                      </FieldGroup>

                      <FieldGroup label="接口地址 / Base URL">
                        <InputShell icon={Globe}>
                          <input
                            value={config.OPENAI_BASE_URL}
                            onChange={(event) => handleChange("OPENAI_BASE_URL", event.target.value)}
                            className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none"
                            placeholder="https://api.openai.com/v1"
                          />
                        </InputShell>
                      </FieldGroup>

                      <FieldGroup label="模型 ID / Model">
                        <InputShell icon={Terminal}>
                          <input
                            value={config.OPENAI_MODEL}
                            onChange={(event) => handleChange("OPENAI_MODEL", event.target.value)}
                            className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                            placeholder="gpt-5.2"
                          />
                        </InputShell>
                      </FieldGroup>

                      <FieldGroup label="API 密钥 / Key" className="xl:col-span-2">
                        <InputShell icon={ShieldCheck}>
                          <input
                            type={showKey ? "text" : "password"}
                            value={config.OPENAI_API_KEY}
                            onChange={(event) => handleChange("OPENAI_API_KEY", event.target.value)}
                            className="w-full bg-transparent py-2 pr-2 text-sm font-mono font-medium text-on-surface outline-none"
                            placeholder="sk-..."
                          />
                          <button
                            type="button"
                            onClick={() => setShowKey((current) => !current)}
                            className="rounded-[8px] p-2 text-on-surface-variant/35 transition-colors hover:bg-surface-container-low hover:text-on-surface"
                          >
                            {showKey ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                          </button>
                        </InputShell>
                      </FieldGroup>
                    </div>
                    ) : null}
                  </SettingsSection>

                  <SettingsSection
                    icon={SettingsIcon}
                    title="图标工坊图像生成"
                    description="这里专门配置图标工坊用来生成文件夹预览图标的 AI 绘图模型。它在分析目录结构时，会自动复用上面的文本模型。"
                    actions={
                      <Button
                        onClick={() => void handleTest("icon_image")}
                        disabled={testIconImage || !iconConfig?.image_model.base_url || !iconConfig?.image_model.model || !iconConfig?.image_model.api_key}
                        loading={testIconImage}
                        variant="secondary"
                        size="sm"
                        className="px-5 py-2.5"
                      >
                        测试生图能力
                      </Button>
                    }
                  >
                    <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-low px-4 py-4">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-[12px] font-medium text-on-surface-variant/60">当前文本来源</p>
                          <p className="text-[14px] font-semibold text-on-surface">
                            {iconConfig.text_model.model || config.OPENAI_MODEL || "未配置文本模型"}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[12px] font-medium text-on-surface-variant/60">当前图像模型</p>
                          <p className="text-[14px] font-semibold text-on-surface">
                            {iconConfig.image_model.model || "未配置图像生成模型"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 rounded-[10px] border border-primary/12 bg-primary/6 px-4 py-3 text-[12px] leading-6 text-primary/85">
                        图标工坊的「文件夹标签抽取」和「灵感文案生成」将直接使用第一项的文本模型能力。
                      </div>
                    </div>

                    {testResult?.type === "icon_image" ? (
                      <div
                        className={cn(
                          "flex items-center gap-3 rounded-[10px] border px-4 py-3 text-[12px] font-medium",
                          testResult.status === "success"
                            ? "border-emerald-500/10 bg-emerald-500/5 text-emerald-700"
                            : "border-error/10 bg-error/5 text-error",
                        )}
                      >
                        {testResult.status === "success" ? (
                          <CheckCircle2 className="h-4.5 w-4.5 shrink-0" />
                        ) : (
                          <AlertCircle className="h-4.5 w-4.5 shrink-0" />
                        )}
                        <p>{testResult.message}</p>
                      </div>
                    ) : null}

                    <div className="grid gap-4 xl:grid-cols-2">
                      <FieldGroup label="图像生成接口地址" hint="可填 base URL 或完整 images/generations 地址。魔搭兼容端点也走这里。">
                        <InputShell icon={Globe}>
                          <input
                            value={iconConfig.image_model.base_url}
                            onChange={(event) =>
                              setIconConfig((current) =>
                                current
                                  ? {
                                      ...current,
                                      image_model: { ...current.image_model, base_url: event.target.value },
                                    }
                                  : current,
                              )
                            }
                            className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none"
                            placeholder="https://api.openai.com/v1"
                          />
                        </InputShell>
                      </FieldGroup>

                      <FieldGroup label="图像生成模型 ID">
                        <InputShell icon={Terminal}>
                          <input
                            value={iconConfig.image_model.model}
                            onChange={(event) =>
                              setIconConfig((current) =>
                                current
                                  ? {
                                      ...current,
                                      image_model: { ...current.image_model, model: event.target.value },
                                    }
                                  : current,
                              )
                            }
                            className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                            placeholder="gpt-image-1"
                          />
                        </InputShell>
                      </FieldGroup>

                      <FieldGroup label="图像生成 API 密钥" className="xl:col-span-2">
                        <InputShell icon={ShieldCheck}>
                          <input
                            type={showIconImageKey ? "text" : "password"}
                            value={iconConfig.image_model.api_key}
                            onChange={(event) =>
                              setIconConfig((current) =>
                                current
                                  ? {
                                      ...current,
                                      image_model: { ...current.image_model, api_key: event.target.value },
                                    }
                                  : current,
                              )
                            }
                            className="w-full bg-transparent py-2 pr-2 text-sm font-mono font-medium text-on-surface outline-none"
                            placeholder="sk-..."
                          />
                          <button
                            type="button"
                            onClick={() => setShowIconImageKey((current) => !current)}
                            className="rounded-[8px] p-2 text-on-surface-variant/35 transition-colors hover:bg-surface-container-low hover:text-on-surface"
                          >
                            {showIconImageKey ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                          </button>
                        </InputShell>
                      </FieldGroup>

                      <FieldGroup label="图像尺寸">
                        <InputShell icon={Layers3}>
                          <input
                            value={iconConfig.image_size}
                            onChange={(event) =>
                              setIconConfig((current) =>
                                current
                                  ? {
                                      ...current,
                                      image_size: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                            placeholder="1024x1024"
                          />
                        </InputShell>
                      </FieldGroup>

                      <FieldGroup label="并发生成上限">
                        <InputShell icon={Terminal}>
                          <input
                            type="number"
                            min={1}
                            max={6}
                            value={iconConfig.concurrency_limit}
                            onChange={(event) =>
                              setIconConfig((current) =>
                                (current
                                  ? {
                                    ...current,
                                    concurrency_limit: Number(event.target.value) || 1,
                                  }
                                  : current)
                              )
                            }
                            className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                          />
                        </InputShell>
                      </FieldGroup>

                      <FieldGroup label="图标保存模式" className="xl:col-span-2">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <StrategyOptionButton
                            active={iconConfig.save_mode === "centralized"}
                            label="集中存储（推荐）"
                            description="图标统一保存在应用数据目录，不污染你的文件夹，且支持全局管理。"
                            onClick={() =>
                              setIconConfig((current) => (current ? { ...current, save_mode: "centralized" } : current))
                            }
                          />
                          <StrategyOptionButton
                            active={iconConfig.save_mode === "in_folder"}
                            label="存放在文件夹内"
                            description="图标保存在每个文件夹内部。如果你经常移动文件夹到其他电脑，建议使用此项。"
                            onClick={() =>
                              setIconConfig((current) => (current ? { ...current, save_mode: "in_folder" } : current))
                            }
                          />
                        </div>
                      </FieldGroup>
                    </div>
                  </SettingsSection>

                  <SettingsSection
                    icon={Globe}
                    title="图片理解设置"
                    description="针对包含整理图片需求的额外视觉增强（不适用于普通的系统文件整理）；需要明确打开开关才会生效。"
                    actions={
                      <div className="flex items-center gap-3">
                        {config.IMAGE_ANALYSIS_ENABLED ? (
                          <Button
                            onClick={() => void handleTest("vision")}
                            disabled={
                              testVision
                              || !config.IMAGE_ANALYSIS_BASE_URL
                              || !config.IMAGE_ANALYSIS_MODEL
                              || !config.IMAGE_ANALYSIS_API_KEY
                            }
                            loading={testVision}
                            variant="secondary"
                            size="sm"
                            className="px-5 py-2.5"
                          >
                            测试图片能力
                          </Button>
                        ) : null}
                        <div className="flex items-center gap-3 rounded-[10px] border border-on-surface/8 bg-surface-container-low px-3 py-2">
                          <span className="text-[12px] font-medium text-on-surface-variant/55">开关</span>
                          <ToggleSwitch
                            checked={Boolean(config.IMAGE_ANALYSIS_ENABLED)}
                            onClick={() => handleChange("IMAGE_ANALYSIS_ENABLED", !config.IMAGE_ANALYSIS_ENABLED)}
                          />
                        </div>
                      </div>
                    }
                    disabled={!config.IMAGE_ANALYSIS_ENABLED}
                  >
                    <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-low px-4 py-4">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-[12px] font-medium text-on-surface-variant/60">当前图片预设</p>
                          <p className="text-[14px] font-semibold text-on-surface">{visionPresets.find((preset) => preset.id === activeVisionPresetId)?.name || "默认图片模型"}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[12px] font-medium text-on-surface-variant/60">图片理解</p>
                          <p className={cn("text-[14px] font-semibold", config.IMAGE_ANALYSIS_ENABLED ? "text-primary" : "text-on-surface-variant")}>
                            {config.IMAGE_ANALYSIS_ENABLED ? "已开启" : "未开启"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[12px] leading-5 text-on-surface-variant/65">
                          只有当“开关”保持开启状态时，所选的图片预设才会在文件整理分析中发挥作用。
                        </p>
                        <button
                          type="button"
                          onClick={() => setVisionEditorExpanded((current) => !current)}
                          className="inline-flex items-center gap-2 rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-3 py-1.5 text-[12px] font-medium text-on-surface-variant transition-colors hover:text-on-surface"
                        >
                          {visionEditorExpanded ? "收起编辑区" : "展开编辑区"}
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", visionEditorExpanded && "rotate-180")} />
                        </button>
                      </div>
                    </div>

                    <PresetManager
                      title="图片预设"
                      presets={visionPresets}
                      activeId={activeVisionPresetId}
                      onSwitch={(id) => handleSwitchPreset("vision", id)}
                      onAdd={() => handleAddPreset("vision")}
                      onDelete={(preset) => handleDeletePreset("vision", preset)}
                    />

                    {testResult?.type === "vision" ? (
                      <div
                        className={cn(
                          "flex items-center gap-3 rounded-[10px] border px-4 py-3 text-[12px] font-medium",
                          testResult.status === "success"
                            ? "border-emerald-500/10 bg-emerald-500/5 text-emerald-700"
                            : "border-error/10 bg-error/5 text-error",
                        )}
                      >
                        {testResult.status === "success" ? (
                          <CheckCircle2 className="h-4.5 w-4.5 shrink-0" />
                        ) : (
                          <AlertCircle className="h-4.5 w-4.5 shrink-0" />
                        )}
                        <p>{testResult.message}</p>
                      </div>
                    ) : null}

                    {visionEditorExpanded ? (
                    <div
                      className={cn(
                        "grid gap-4 xl:grid-cols-2",
                        !config.IMAGE_ANALYSIS_ENABLED && "pointer-events-none",
                      )}
                    >
                      <FieldGroup label="图片预设名称" className="xl:col-span-2">
                        <InputShell icon={Edit3}>
                          <input
                            value={config.IMAGE_ANALYSIS_NAME ?? ""}
                            onChange={(event) => handleChange("IMAGE_ANALYSIS_NAME", event.target.value)}
                            className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                            placeholder="例如：Qwen Vision"
                          />
                        </InputShell>
                      </FieldGroup>

                      <FieldGroup label="图片接口地址">
                        <InputShell icon={Globe}>
                          <input
                            value={config.IMAGE_ANALYSIS_BASE_URL}
                            onChange={(event) => handleChange("IMAGE_ANALYSIS_BASE_URL", event.target.value)}
                            className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none"
                            placeholder="https://api.openai.com/v1"
                          />
                        </InputShell>
                      </FieldGroup>

                      <FieldGroup label="图片模型 ID">
                        <InputShell icon={Terminal}>
                          <input
                            value={config.IMAGE_ANALYSIS_MODEL}
                            onChange={(event) => handleChange("IMAGE_ANALYSIS_MODEL", event.target.value)}
                            className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                            placeholder="gpt-4o"
                          />
                        </InputShell>
                      </FieldGroup>

                      <FieldGroup label="图片接口密钥" className="xl:col-span-2">
                        <InputShell icon={ShieldCheck}>
                          <input
                            type={showVisionKey ? "text" : "password"}
                            value={config.IMAGE_ANALYSIS_API_KEY}
                            onChange={(event) => handleChange("IMAGE_ANALYSIS_API_KEY", event.target.value)}
                            className="w-full bg-transparent py-2 pr-2 text-sm font-mono font-medium text-on-surface outline-none"
                            placeholder="sk-..."
                          />
                          <button
                            type="button"
                            onClick={() => setShowVisionKey((current) => !current)}
                            className="rounded-[8px] p-2 text-on-surface-variant/35 transition-colors hover:bg-surface-container-low hover:text-on-surface"
                          >
                            {showVisionKey ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                          </button>
                        </InputShell>
                      </FieldGroup>
                    </div>
                    ) : null}
                  </SettingsSection>
                </>
              ) : null}

              {activeCategory === "launch" ? (
                <SettingsSection
                  icon={SettingsIcon}
                  title="新任务启动"
                  description="自定义首页的默认选型，免去频繁设置策略模板、命名风格等基础偏好参数的繁琐步骤。"
                >
                  <div className="grid gap-4 xl:grid-cols-2">
                    <FieldGroup
                      label="默认整理模板"
                      hint="这些值会作为首页当前预设显示，也会作为策略弹窗的预填值。"
                      className="xl:col-span-2"
                    >
                      <div className="grid gap-3 xl:grid-cols-2">
                        {STRATEGY_TEMPLATES.map((template) => (
                          <StrategyOptionButton
                            key={template.id}
                            active={config.LAUNCH_DEFAULT_TEMPLATE_ID === template.id}
                            label={template.label}
                            description={template.description}
                            onClick={() => handleLaunchTemplateChange(template.id)}
                          />
                        ))}
                      </div>
                    </FieldGroup>

                    <FieldGroup label="默认命名风格">
                      <div className="grid gap-3">
                        {NAMING_STYLE_OPTIONS.map((option) => (
                          <StrategyOptionButton
                            key={option.id}
                            active={config.LAUNCH_DEFAULT_NAMING_STYLE === option.id}
                            label={option.label}
                            description={option.description}
                            onClick={() => handleChange("LAUNCH_DEFAULT_NAMING_STYLE", option.id)}
                          />
                        ))}
                      </div>
                    </FieldGroup>

                    <FieldGroup label="默认整理方式">
                      <div className="grid gap-3">
                        {CAUTION_LEVEL_OPTIONS.map((option) => (
                          <StrategyOptionButton
                            key={option.id}
                            active={config.LAUNCH_DEFAULT_CAUTION_LEVEL === option.id}
                            label={option.label}
                            description={option.description}
                            onClick={() => handleChange("LAUNCH_DEFAULT_CAUTION_LEVEL", option.id)}
                          />
                        ))}
                      </div>
                    </FieldGroup>

                    <FieldGroup
                      label="默认补充说明"
                      hint="例如：项目文件尽量放在一起；拿不准的先放 Review。"
                      className="xl:col-span-2"
                    >
                      <textarea
                        value={config.LAUNCH_DEFAULT_NOTE}
                        onChange={(event) => handleChange("LAUNCH_DEFAULT_NOTE", event.target.value.slice(0, 200))}
                        className="min-h-28 w-full resize-none rounded-[10px] border border-on-surface/8 bg-white px-4 py-3 text-[14px] leading-7 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary focus:ring-4 focus:ring-primary/5"
                        placeholder="例如：学习资料尽量按课程整理，不确定的先留在 Review。"
                      />
                    </FieldGroup>
                  </div>

                  <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-low px-4 py-3.5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1.5">
                        <h3 className="text-[13px] font-semibold tracking-tight text-on-surface">直接用默认值启动</h3>
                        <p className="text-[12px] leading-5 text-on-surface-variant/65">
                          开启后，点击首页“立刻开始”会直接使用默认策略进入主屏幕，不再弹出确认对话框。
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={Boolean(config.LAUNCH_SKIP_STRATEGY_PROMPT)}
                        onClick={() => handleChange("LAUNCH_SKIP_STRATEGY_PROMPT", !config.LAUNCH_SKIP_STRATEGY_PROMPT)}
                      />
                    </div>
                  </div>

                  <div className="rounded-[8px] border border-primary/12 bg-primary/6 px-4 py-3.5">
                    <p className="text-[12px] leading-6 text-primary/85">
                      即使不勾选直接启动，首页策略弹窗也会以上方数值作为最优先的预填起点。
                    </p>
                  </div>
                </SettingsSection>
              ) : null}

              {activeCategory === "advanced" ? (
                <SettingsSection
                  icon={ShieldCheck}
                  title="其他设置"
                  description="保留少量高频开关，不把设置页扩成调试控制台。"
                >
                  <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-low px-4 py-3.5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1.5">
                        <h3 className="text-[13px] font-semibold tracking-tight text-on-surface">详细日志</h3>
                        <p className="text-[12px] leading-5 text-on-surface-variant/65">
                          基础运行日志始终写入 `logs/backend/runtime.log`；打开后会额外写入 `logs/backend/debug.jsonl`。
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={Boolean(config.DEBUG_MODE)}
                        onClick={() => handleChange("DEBUG_MODE", !config.DEBUG_MODE)}
                      />
                    </div>
                  </div>
                </SettingsSection>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-on-surface/6 px-1 pt-2 text-[11px] text-on-surface-variant/40">
            <p>Local Settings</p>
            <p>保存后，当前激活的文本/图片预设会在后续整理会话中直接生效。</p>
          </div>
        </div>
      </main>

      <AnimatePresence>
        {dialog ? (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
              onClick={() => setDialog(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 20 }}
              className="relative w-full max-w-[440px] rounded-[8px] border border-on-surface/8 bg-white p-6 shadow-[0_20px_48px_rgba(0,0,0,0.14)]"
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h3 className="text-[1.05rem] font-black tracking-tight text-on-surface">{dialog.title}</h3>
                  <p className="text-[14px] leading-6 text-on-surface-variant/75">{dialog.message}</p>
                </div>

                {dialog.type === "prompt" ? (
                  <InputShell icon={Edit3}>
                    <input
                      autoFocus
                      value={dialog.value}
                      onChange={(event) => setDialog({ ...dialog, value: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          dialog.onConfirm(dialog.value);
                        }
                      }}
                      className="w-full bg-transparent py-2 text-[14px] font-semibold text-on-surface outline-none"
                    />
                  </InputShell>
                ) : null}

                <div className="flex items-center gap-3 pt-2">
                  <Button variant="secondary" onClick={() => setDialog(null)} className="flex-1 py-3">
                    取消
                  </Button>
                  <Button variant="primary" onClick={() => dialog.onConfirm(dialog.value)} className="flex-1 py-3">
                    {dialog.type === "confirm" ? "确定" : "创建"}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
