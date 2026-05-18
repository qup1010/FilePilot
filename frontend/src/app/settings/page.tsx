"use client";

import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Cpu,
  Eye,
  EyeOff,
  FolderPlus,
  FolderOpen,
  Globe,
  ImageIcon,
  Key,
  Layers3,
  Loader2,
  Lock,
  LogOut,
  RefreshCcw,
  RefreshCw,
  Scissors,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { findDropZoneForPosition, listenToTauriDragDrop } from "@/lib/tauri-drag-drop";
import {
  buildStrategySummary,
  CAUTION_LEVEL_OPTIONS,
  DENSITY_OPTIONS,
  getSuggestedSelection,
  getTemplateMeta,
  LANGUAGE_OPTIONS,
  PREFIX_STYLE_OPTIONS,
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
  VisionSourceMode,
  VisionSettingsPreset,
} from "@/types/settings";
import type { OrganizeMethod, TargetProfile, TargetProfileDirectory } from "@/types/session";

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

type TargetProfileDraft = {
  name: string;
  directories: TargetProfileDirectory[];
  newPath: string;
  newLabel: string;
  newDescription: string;
};

type LaunchSection = "strategy" | "placement" | "targets";
type ProviderSummaryKind = "text" | "vision" | "icon_image";
const SETTINGS_TAB_IDS = ["text", "icon_image", "bg_removal", "launch", "system"] as const;

const APP_CONTEXT_EVENT = "file-pilot-context-change";
const SETTINGS_CONTEXT_KEY = "settings_header_context";
const IMAGE_SIZE_OPTIONS = ["1024x1024", "512x512", "256x256"] as const;

const formatProviderLabel = (value?: string) => {
  if (value === "openai_compatible") {
    return "OpenAI 兼容服务";
  }
  return value?.trim() || "OpenAI 兼容服务";
};

const formatApiFormatLabel = (value?: string) => {
  if (value === "openai_chat_completions") {
    return "聊天补全接口";
  }
  return value?.trim() || "聊天补全接口";
};

const formatToolModeLabel = (value?: string) => {
  if (value === "native") {
    return "支持工具调用";
  }
  return value?.trim() || "支持工具调用";
};

function ProviderCapabilitySummary({
  title,
  kind,
  provider,
  apiFormat,
  toolMode,
  capabilities,
}: {
  title: string;
  kind: ProviderSummaryKind;
  provider?: string;
  apiFormat?: string;
  toolMode?: string;
  capabilities?: SettingsSnapshot["families"]["text"]["active_preset"]["capabilities"];
}) {
  const serviceLabel = formatProviderLabel(provider);
  const formatLabel = kind === "icon_image" ? "图像生成接口" : formatApiFormatLabel(apiFormat);
  const abilityLabel = kind === "icon_image" ? "图标预览生成" : formatToolModeLabel(toolMode);
  const badgeLabel = kind === "icon_image" ? "适用于 OpenAI 兼容生图服务" : "适用于 DeepSeek / OpenRouter 等兼容服务";
  const caps = {
    chat: capabilities?.chat ?? true,
    streaming: capabilities?.streaming ?? true,
    tools: capabilities?.tools ?? true,
    vision: capabilities?.vision ?? true,
    json_output: capabilities?.json_output ?? true,
    image_generation: capabilities?.image_generation ?? false,
  };
  const chips =
    kind === "icon_image"
      ? [
        { label: "生图端点", active: true },
        { label: "可测试连接", active: true },
      ]
      : kind === "vision"
        ? [
          { label: caps.vision ? "支持图片输入" : "图片能力未声明", active: caps.vision },
          { label: caps.json_output ? "支持结构化结果" : "结构化能力未声明", active: caps.json_output },
        ]
        : [
          { label: caps.streaming ? "支持实时回复" : "实时回复未声明", active: caps.streaming },
          { label: caps.json_output ? "支持结构化结果" : "结构化能力未声明", active: caps.json_output },
        ];

  return (
    <div
      className="xl:col-span-2 flex flex-wrap items-center gap-2 rounded-[6px] border border-on-surface/6 bg-surface-container-lowest/70 px-3 py-2 text-[11.5px]"
      title={badgeLabel}
    >
      <div className="flex min-w-0 items-center gap-2 pr-1">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary/65" />
        <span className="shrink-0 font-bold text-on-surface-variant/65">{title}</span>
        <span className="truncate font-semibold text-on-surface/85">
          {serviceLabel} · {formatLabel} · {abilityLabel}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip.label}
            className={cn(
              "rounded-[5px] border px-1.5 py-0.5 text-[10.5px] font-semibold",
              chip.active
                ? "border-primary/15 bg-primary/[0.04] text-primary"
                : "border-on-surface/8 bg-surface text-on-surface-variant/55",
            )}
          >
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}
const COMPACT_SETTINGS_BREAKPOINT = 960;

function targetDirectoryEditorKey(profileId: string, path: string): string {
  return `${profileId}::${path.trim().toLowerCase()}`;
}

function normalizeImageSize(value: string | null | undefined): (typeof IMAGE_SIZE_OPTIONS)[number] {
  if (value && IMAGE_SIZE_OPTIONS.includes(value as (typeof IMAGE_SIZE_OPTIONS)[number])) {
    return value as (typeof IMAGE_SIZE_OPTIONS)[number];
  }
  return "1024x1024";
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createSecretDraft(initialValue: string = ""): SecretDraft {
  return { action: "keep", value: initialValue, visible: false };
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
    return "新密钥已输入，保存当前修改后生效。";
  }
  if (secret.action === "clear") {
    return "已标记为移除，保存当前修改后生效。";
  }
  return secretState === "stored" ? "密钥已在本地安全存储。" : "当前还没有保存密钥。";
}

const LAUNCH_GLOBAL_KEYS = [
  "LAUNCH_DEFAULT_TEMPLATE_ID",
  "LAUNCH_DEFAULT_ORGANIZE_METHOD",
  "LAUNCH_DEFAULT_LANGUAGE",
  "LAUNCH_DEFAULT_DENSITY",
  "LAUNCH_DEFAULT_PREFIX_STYLE",
  "LAUNCH_DEFAULT_CAUTION_LEVEL",
  "LAUNCH_DEFAULT_NOTE",
  "LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT",
  "LAUNCH_DEFAULT_REVIEW_ROOT",
  "LAUNCH_REVIEW_FOLLOWS_NEW_ROOT",
  "LAUNCH_SKIP_STRATEGY_PROMPT",
  "LAUNCH_DEFAULT_TARGET_PROFILE_ID",
] as const;

function pickGlobalConfig(source: SettingsSnapshot["global_config"], keys: readonly string[]) {
  return keys.reduce<Record<string, unknown>>((result, key) => {
    result[key] = source[key];
    return result;
  }, {});
}

function buildSettingsTabFingerprint(
  tabId: string,
  draft: DraftState | null,
  secrets: Record<SettingsFamily, SecretDraft>,
  transientInputs: {
    analysisConcurrencyInput: string;
    imageConcurrencyInput: string;
  },
) {
  if (!draft) {
    return "";
  }

  if (tabId === "text") {
    return JSON.stringify({
      text: draft.text,
      visionEnabled: Boolean(draft.global_config.IMAGE_ANALYSIS_ENABLED),
      visionMode: getVisionSourceMode(draft.global_config),
      vision: draft.vision,
      secret: { action: secrets.text.action, value: secrets.text.value },
      visionSecret: { action: secrets.vision.action, value: secrets.vision.value },
    });
  }
  if (tabId === "icon_image") {
    return JSON.stringify({
      icon_image: draft.icon_image,
      analysisConcurrencyInput: transientInputs.analysisConcurrencyInput,
      imageConcurrencyInput: transientInputs.imageConcurrencyInput,
      secret: { action: secrets.icon_image.action, value: secrets.icon_image.value },
    });
  }
  if (tabId === "bg_removal") {
    return JSON.stringify({
      bg_removal: draft.bg_removal,
      secret: { action: secrets.bg_removal.action, value: secrets.bg_removal.value },
    });
  }
  if (tabId === "launch") {
    return JSON.stringify(pickGlobalConfig(draft.global_config, LAUNCH_GLOBAL_KEYS));
  }
  if (tabId === "system") {
    return JSON.stringify({
      DEBUG_MODE: Boolean(draft.global_config.DEBUG_MODE),
    });
  }
  return "";
}

function createSecretDraftsFromSnapshot(snapshot: SettingsSnapshot): Record<SettingsFamily, SecretDraft> {
  return {
    text: createSecretDraft(snapshot.families.text.active_preset.OPENAI_API_KEY || ""),
    vision: createSecretDraft(snapshot.families.vision.active_preset.IMAGE_ANALYSIS_API_KEY || ""),
    icon_image: createSecretDraft(snapshot.families.icon_image.active_preset.image_model.api_key || ""),
    bg_removal: createSecretDraft(snapshot.families.bg_removal.active_preset.hf_api_token || ""),
  };
}

function describeConnectionIssue(result: SettingsTestResult) {
  if (result.code === "network_blocked") {
    return "这次请求更像是被本机网络层拦截了。请优先检查 Windows 防火墙、安全软件、代理、TUN 或分流规则，而不只是模型配置本身。";
  }
  if (result.code === "vision_image_format_rejected") {
    return "接口已经返回响应，但当前服务商可能不接受这次测试使用的图片传入格式。通常需要改供应商兼容适配，而不是单纯重填模型名称。";
  }
  const haystack = `${result.code} ${result.message}`.toLowerCase();
  if (/(timeout|timed out|504|gateway)/.test(haystack)) {
    return "远端服务响应超时或代理网关过慢，可以稍后重试，或换一个更稳定的接口地址。";
  }
  if (/(401|403|unauthori[sz]ed|forbidden|api key|apikey|密钥|key)/.test(haystack)) {
    return "密钥或访问权限可能不正确，请检查 API Key、账号额度和接口权限。";
  }
  if (/(model|模型|not found|404)/.test(haystack)) {
    return "模型名称可能不可用，或当前账号没有该模型的调用权限。";
  }
  if (/(network|fetch|connect|econn|dns|refused|unreachable|不可达|连接)/.test(haystack)) {
    return "本地或远端服务不可达，请检查接口地址、网络代理和后端服务状态。";
  }
  return "请求没有成功完成，请根据错误信息检查当前配置。";
}

function getVisionSourceMode(globalConfig: SettingsSnapshot["global_config"] | null | undefined): VisionSourceMode {
  return globalConfig?.IMAGE_ANALYSIS_SOURCE_MODE === "separate" ? "separate" : "shared_text";
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

function copyTextToClipboard(value: string, onSuccess: (message: string) => void, onError: (message: string) => void) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    onError("当前环境不支持复制日志路径。");
    return;
  }
  void navigator.clipboard.writeText(value).then(
    () => onSuccess("日志路径已复制"),
    () => onError("复制日志路径失败"),
  );
}

function buildTargetProfilesFingerprint(drafts: Record<string, TargetProfileDraft>): string {
  return JSON.stringify(
    Object.entries(drafts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([profileId, draft]) => ({
        profile_id: profileId,
        name: draft.name.trim(),
        directories: draft.directories
          .map((item) => ({
            path: item.path.trim(),
            label: item.label?.trim() || "",
            description: item.description?.trim() || "",
          }))
          .filter((item) => item.path)
          .sort((left, right) => left.path.localeCompare(right.path)),
      })),
  );
}

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const normalizedInitialTab = initialTab === "vision" ? "text" : initialTab;
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
  const [activeTab, setActiveTab] = useState<string>(
    normalizedInitialTab && SETTINGS_TAB_IDS.includes(normalizedInitialTab as (typeof SETTINGS_TAB_IDS)[number]) ? normalizedInitialTab : "text",
  );
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [targetProfiles, setTargetProfiles] = useState<TargetProfile[]>([]);
  const [targetProfilesLoading, setTargetProfilesLoading] = useState(false);
  const [targetProfileDrafts, setTargetProfileDrafts] = useState<Record<string, TargetProfileDraft>>({});
  const [expandedTargetDirectoryEditors, setExpandedTargetDirectoryEditors] = useState<Record<string, boolean>>({});
  const [targetProfilesBaseline, setTargetProfilesBaseline] = useState("");
  const [newTargetProfileName, setNewTargetProfileName] = useState("常用目标目录");
  const [selectedTargetProfileId, setSelectedTargetProfileId] = useState<string>("");
  const [targetProfileSelectorOpen, setTargetProfileSelectorOpen] = useState(false);
  const [creatingTargetProfile, setCreatingTargetProfile] = useState(false);
  const [activeLaunchSection, setActiveLaunchSection] = useState<LaunchSection>("strategy");
  const [dragTargetProfileId, setDragTargetProfileId] = useState<string | null>(null);
  const targetProfileSelectorRef = useRef<HTMLDivElement>(null);
  const targetDropZoneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pendingDeleteTargetProfileId, setPendingDeleteTargetProfileId] = useState<string | null>(null);

  const categories = [
    { id: "text", label: "整理模型配置", icon: Layers3, description: "配置分析与整理的模型接口" },
    { id: "launch", label: "整理策略配置", icon: SettingsIcon, description: "任务启动配置" },
    { id: "icon_image", label: "生图模型配置", icon: ImageIcon, description: "配置生图模型接口" },
    { id: "bg_removal", label: "抠图服务配置", icon: Scissors, description: "配置抠图服务接口" },

    { id: "system", label: "系统与调试", icon: ShieldCheck, description: "运行状态与日志" },
  ];

  const launchSections: Array<{
    id: LaunchSection;
    label: string;
    description: string;
    icon: typeof SettingsIcon;
  }> = [
      { id: "strategy", label: "启动策略", description: "模板、语言、粒度", icon: SlidersHorizontal },
      { id: "placement", label: "放置规则", description: "新目录与待确认区", icon: FolderOpen },
      { id: "targets", label: "目标目录", description: "归档目录池", icon: FolderPlus },
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
  const selectedTargetProfile = targetProfiles.find((profile) => profile.profile_id === selectedTargetProfileId) ?? targetProfiles[0] ?? null;
  const selectedTargetProfileDraft = selectedTargetProfile ? targetProfileDrafts[selectedTargetProfile.profile_id] : null;
  const selectedTargetProfileName = selectedTargetProfileDraft?.name || selectedTargetProfile?.name || "选择目标目录配置";
  const selectedTargetDirectoryCount = selectedTargetProfileDraft?.directories.length ?? selectedTargetProfile?.directories.length ?? 0;

  const settingsDirty = useMemo(
    () =>
      buildFingerprint(draft, secretMap, {
        analysisConcurrencyInput,
        imageConcurrencyInput,
      }) !== baseline,
    [analysisConcurrencyInput, baseline, draft, imageConcurrencyInput, secretMap],
  );
  const targetProfilesDirty = useMemo(
    () => buildTargetProfilesFingerprint(targetProfileDrafts) !== targetProfilesBaseline,
    [targetProfileDrafts, targetProfilesBaseline],
  );
  const isDirty = settingsDirty || targetProfilesDirty;
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
      result[tabId] = baselineValue !== currentValue || (tabId === "launch" && targetProfilesDirty);
      return result;
    }, {});
  }, [analysisConcurrencyInput, draft, imageConcurrencyInput, secretMap, snapshot, targetProfilesDirty]);
  const dirtyTabLabels = useMemo(
    () => categories.filter((item) => dirtyTabs[item.id]).map((item) => item.label),
    [categories, dirtyTabs],
  );
  const healthItems = useMemo(
    () => [
      {
        label: "文本分析",
        description: "整理规划必需",
        configured: Boolean(snapshot?.status.text_configured),
        optional: false,
        icon: Layers3,
      },
      {
        label: "图片理解",
        description: "图片/截图增强",
        configured: Boolean(snapshot?.status.vision_configured),
        optional: true,
        icon: Globe,
      },
      {
        label: "图标生成",
        description: "图标工坊需要",
        configured: Boolean(snapshot?.status.icon_image_configured),
        optional: true,
        icon: ImageIcon,
      },
      {
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
      text: createSecretDraft(textKey),
      vision: createSecretDraft(visionKey),
      icon_image: createSecretDraft(iconKey),
      bg_removal: createSecretDraft(bgKey),
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

  const hydrateTargetProfiles = useCallback((items: TargetProfile[]) => {
    setTargetProfiles(items);
    setSelectedTargetProfileId((current) => {
      if (items.some((item) => item.profile_id === current)) {
        return current;
      }
      return items[0]?.profile_id ?? "";
    });
    const next: Record<string, TargetProfileDraft> = {};
    for (const profile of items) {
      next[profile.profile_id] = {
        name: profile.name,
        directories: profile.directories,
        newPath: "",
        newLabel: "",
        newDescription: "",
      };
    }
    setTargetProfileDrafts(next);
    setTargetProfilesBaseline(buildTargetProfilesFingerprint(next));
  }, []);

  const loadTargetProfiles = useCallback(async () => {
    setTargetProfilesLoading(true);
    try {
      hydrateTargetProfiles(await api.getTargetProfiles());
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取目标目录配置失败");
    } finally {
      setTargetProfilesLoading(false);
    }
  }, [api, hydrateTargetProfiles]);

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
    void loadTargetProfiles();
  }, [loadTargetProfiles]);

  useEffect(() => {
    if (!targetProfileSelectorOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!targetProfileSelectorRef.current?.contains(event.target as Node)) {
        setTargetProfileSelectorOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTargetProfileSelectorOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [targetProfileSelectorOpen]);

  const addDirectoriesRef = useRef<(profileId: string, paths: string[]) => void>(null as any);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listenToTauriDragDrop((event) => {
      if (event.payload.type === "over") {
        const profileId = findDropZoneForPosition(
          event.payload.position,
          Object.entries(targetDropZoneRefs.current).map(([key, element]) => ({ key, element })),
        );
        setDragTargetProfileId(profileId);
        return;
      }

      if (event.payload.type === "leave") {
        setDragTargetProfileId(null);
        return;
      }

      if (event.payload.type === "drop") {
        const profileId = findDropZoneForPosition(
          event.payload.position,
          Object.entries(targetDropZoneRefs.current).map(([key, element]) => ({ key, element })),
        );
        setDragTargetProfileId(null);
        if (profileId) {
          void addDirectoriesRef.current(profileId, event.payload.paths);
        }
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten?.();
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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

  const launchTemplate = getTemplateMeta(draft?.global_config.LAUNCH_DEFAULT_TEMPLATE_ID ?? "general_downloads");
  const launchDefaultOrganizeMethod = (
    draft?.global_config.LAUNCH_DEFAULT_ORGANIZE_METHOD === "assign_into_existing_categories"
      ? "assign_into_existing_categories"
      : "categorize_into_new_structure"
  ) satisfies OrganizeMethod;
  const launchDefaultTargetProfileId = String(draft?.global_config.LAUNCH_DEFAULT_TARGET_PROFILE_ID ?? "");
  const launchDefaultTargetProfile = targetProfiles.find((profile) => profile.profile_id === launchDefaultTargetProfileId) ?? null;
  const launchDefaultOrganizeMode = launchDefaultOrganizeMethod === "assign_into_existing_categories" ? "incremental" : "initial";
  const launchReviewFollowsNewRoot = draft?.global_config.LAUNCH_REVIEW_FOLLOWS_NEW_ROOT !== false;
  const launchDefaultNewDirectoryRoot = String(draft?.global_config.LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT ?? "");
  const launchDefaultReviewRoot = String(draft?.global_config.LAUNCH_DEFAULT_REVIEW_ROOT ?? "");
  const launchDerivedReviewRoot = launchDefaultNewDirectoryRoot
    ? `${launchDefaultNewDirectoryRoot.replace(/[\\/]$/, "")}/Review`
    : "新目录生成位置/Review";
  const launchStrategyPreview = buildStrategySummary({
    template_id: draft?.global_config.LAUNCH_DEFAULT_TEMPLATE_ID ?? "general_downloads",
    organize_mode: launchDefaultOrganizeMode,
    task_type: launchDefaultOrganizeMethod === "assign_into_existing_categories" ? "organize_into_existing" : "organize_full_directory",
    organize_method: launchDefaultOrganizeMethod,
    target_profile_id: launchDefaultTargetProfileId || undefined,
    destination_index_depth: 2,
    language: draft?.global_config.LAUNCH_DEFAULT_LANGUAGE ?? "zh",
    density: draft?.global_config.LAUNCH_DEFAULT_DENSITY ?? "normal",
    prefix_style: draft?.global_config.LAUNCH_DEFAULT_PREFIX_STYLE ?? "none",
    caution_level: draft?.global_config.LAUNCH_DEFAULT_CAUTION_LEVEL ?? "balanced",
    note: draft?.global_config.LAUNCH_DEFAULT_NOTE ?? "",
  });

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

  const updateTargetProfileDraft = (profileId: string, updater: (current: TargetProfileDraft) => TargetProfileDraft) => {
    setTargetProfileDrafts((current) => {
      const draft = current[profileId];
      if (!draft) {
        return current;
      }
      return {
        ...current,
        [profileId]: updater(draft),
      };
    });
    setSuccess(null);
  };

  const addDirectoriesToTargetProfile = (profileId: string, paths: string[]) => {
    const draft = targetProfileDrafts[profileId];
    if (!draft) {
      return;
    }
    const cleanedPaths = paths.map((path) => path.trim()).filter(Boolean);
    if (!cleanedPaths.length) {
      setError("没有读取到可添加的目录路径。");
      return;
    }

    const seen = new Set(draft.directories.map((item) => item.path.trim().toLowerCase()));
    const additions: TargetProfileDirectory[] = [];
    for (const path of cleanedPaths) {
      const key = path.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      additions.push({ path, description: "" });
    }

    if (!additions.length) {
      setSuccess("这些目录已经在当前配置里");
      return;
    }

    const directories = [...draft.directories, ...additions];
    updateTargetProfileDraft(profileId, (current) => ({ ...current, directories, newPath: "", newLabel: "", newDescription: "" }));
  };

  useEffect(() => {
    addDirectoriesRef.current = addDirectoriesToTargetProfile;
  }, [addDirectoriesToTargetProfile]);

  const saveTargetProfileDrafts = async () => {
    const entries = Object.entries(targetProfileDrafts);
    for (const [, draft] of entries) {
      if (!draft.name.trim()) {
        throw new Error("目标目录配置名称不能为空。");
      }
    }
    setTargetProfilesLoading(true);
    try {
      await Promise.all(
        entries.map(([profileId, draft]) =>
          api.updateTargetProfile(profileId, {
            name: draft.name.trim(),
            directories: draft.directories
              .map((item) => ({
                path: item.path.trim(),
                label: item.label?.trim() || undefined,
                description: item.description?.trim() || undefined,
              }))
              .filter((item) => item.path),
          }),
        ),
      );
      await loadTargetProfiles();
    } finally {
      setTargetProfilesLoading(false);
    }
  };

  const createTargetProfile = async () => {
    const name = newTargetProfileName.trim();
    if (!name) {
      setError("请先输入目标目录配置名称。");
      return;
    }
    setTargetProfilesLoading(true);
    setError(null);
    try {
      const profile = await api.createTargetProfile({ name, directories: [] });
      setNewTargetProfileName("常用目标目录");
      setSelectedTargetProfileId(profile.profile_id);
      setCreatingTargetProfile(false);
      setTargetProfileSelectorOpen(false);
      await loadTargetProfiles();
      setSuccess("目标目录配置已创建");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建目标目录配置失败");
    } finally {
      setTargetProfilesLoading(false);
    }
  };

  const deleteTargetProfile = async (profileId: string) => {
    setTargetProfilesLoading(true);
    setError(null);
    try {
      await api.deleteTargetProfile(profileId);
      setSelectedTargetProfileId((current) => (current === profileId ? "" : current));
      if (draft?.global_config.LAUNCH_DEFAULT_TARGET_PROFILE_ID === profileId) {
        updateGlobal("LAUNCH_DEFAULT_TARGET_PROFILE_ID", "");
      }
      await loadTargetProfiles();
      setSuccess("目标目录配置已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除目标目录配置失败");
    } finally {
      setTargetProfilesLoading(false);
    }
  };

  const addDirectoryToTargetProfile = (profileId: string) => {
    const draft = targetProfileDrafts[profileId];
    if (!draft) {
      return;
    }
    const path = draft.newPath.trim();
    if (!path) {
      setError("请先输入目标目录路径。");
      return;
    }
    const key = path.toLowerCase();
    const directories = [
      ...draft.directories.filter((item) => item.path.trim().toLowerCase() !== key),
      {
        path,
        label: draft.newLabel.trim() || undefined,
        description: draft.newDescription.trim() || undefined,
      },
    ];
    updateTargetProfileDraft(profileId, (current) => ({ ...current, directories, newPath: "", newLabel: "", newDescription: "" }));
  };

  const extractDroppedPaths = (event: React.DragEvent<HTMLElement>): string[] => {
    const textPayload = event.dataTransfer.getData("text/plain");
    const uriPayload = event.dataTransfer.getData("text/uri-list");
    const files = Array.from(event.dataTransfer.files)
      .map((file) => {
        const path = (file as File & { path?: string }).path || (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        return path || "";
      })
      .filter(Boolean);

    const textPaths = `${textPayload}\n${uriPayload}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => (line.startsWith("file:///") ? decodeURIComponent(line.replace(/^file:\/+/, "")) : line));

    return [...files, ...textPaths];
  };

  const removeDirectoryFromTargetProfile = (profileId: string, path: string) => {
    const draft = targetProfileDrafts[profileId];
    if (!draft) {
      return;
    }
    const directories = draft.directories.filter((item) => item.path !== path);
    updateTargetProfileDraft(profileId, (current) => ({ ...current, directories }));
  };

  const handleSelectTab = (tabId: string) => {
    setActiveTab(tabId === "vision" ? "text" : tabId);
    setCategoryDialogOpen(false);
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

    if (snapshot?.families.text.active_preset_id) {
      families.text = {
        ...buildFamilySavePayload("text", {
          OPENAI_BASE_URL: draft.text.OPENAI_BASE_URL,
          OPENAI_MODEL: draft.text.OPENAI_MODEL,
        }),
        secret: buildSecretPayload(textSecret),
      };
    }

    families.vision = {
      enabled: Boolean(draft.global_config.IMAGE_ANALYSIS_ENABLED),
      mode: getVisionSourceMode(draft.global_config),
      ...(snapshot?.families.vision.active_preset_id
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

    if (snapshot?.families.icon_image.active_preset_id) {
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
    }

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
      if (targetProfilesDirty && Object.values(targetProfileDrafts).some((profile) => !profile.name.trim())) {
        throw new Error("目标目录配置名称不能为空。");
      }
      const savedParts: string[] = [];
      const failedParts: string[] = [];
      if (settingsDirty) {
        try {
          const nextSnapshot = await api.updateSettings(payload);
          hydrate(nextSnapshot);
          savedParts.push("模型与全局设置已保存");
        } catch (err) {
          failedParts.push(`模型与全局设置保存失败：${err instanceof Error ? err.message : "未知错误"}`);
        }
      }
      if (targetProfilesDirty) {
        try {
          await saveTargetProfileDrafts();
          savedParts.push("目标目录配置已保存");
        } catch (err) {
          failedParts.push(`目标目录配置保存失败：${err instanceof Error ? err.message : "未知错误"}`);
        }
      }
      if (failedParts.length) {
        const prefix = savedParts.length ? `${savedParts.join("，")}，但` : "";
        setError(`${prefix}${failedParts.join("；")}`);
        return;
      }
      setSuccess(savedParts.length ? `${savedParts.join("，")}并生效` : "设置已保存并生效");
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
    hydrateTargetProfiles(targetProfiles);
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

  const renderResult = (family: SettingsFamily) => {
    const result = testResults[family];
    const isTesting = testingFamily === family;
    const isVision = family === "vision";

    if (isTesting) {
      return (
        <div className="flex items-center gap-3 rounded-[6px] border border-primary/15 bg-primary/5 px-4 py-3">
          <div className="relative h-6 w-6 shrink-0">
            <div className="absolute inset-0 animate-ping rounded-full bg-primary/20 opacity-75" />
            <div className="relative flex h-full w-full items-center justify-center rounded-full bg-primary/10 text-primary">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold tracking-tight text-on-surface">
              {isVision ? "正在验证图片理解能力..." : "正在进行连接测试..."}
            </p>
            <p className="mt-0.5 text-[10px] font-bold tracking-widest text-primary/60">
              {isVision ? "图片能力验证" : "连接探测"}
            </p>
          </div>
        </div>
      );
    }

    if (!result) {
      return null;
    }

    const isOk = result.status === "ok";
    const issueHint = isOk ? null : describeConnectionIssue(result);

    return (
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "flex items-start gap-3.5 rounded-[6px] border px-4 py-3 transition-all",
          isOk
            ? "border-success/20 bg-success/[0.03]"
            : "border-error/20 bg-error/[0.03]",
        )}
      >
        <div className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border",
          isOk ? "border-success/20 bg-success/10 text-success-dim" : "border-error/20 bg-error/10 text-error"
        )}>
          {isOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-4">
            <h4 className={cn("text-[13px] font-bold tracking-tight", isOk ? "text-success-dim" : "text-error-dim")}>
              {isVision ? (isOk ? "图片能力已验证" : "图片能力验证失败") : isOk ? "服务已成功对齐" : "连接测试失败"}
            </h4>
            {isOk && (
              <div className="flex items-center gap-1.5 rounded-[4px] bg-success/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-success-dim">
                <div className="h-1 w-1 rounded-full bg-success animate-pulse" />
                可用
              </div>
            )}
          </div>
          <p className="text-[12px] leading-relaxed text-on-surface/70">{result.message}</p>
          {!isOk && issueHint ? (
            <p className="rounded-[6px] border border-error/10 bg-error/[0.04] px-3 py-2 text-[11.5px] font-medium leading-relaxed text-error-dim">
              {issueHint}
            </p>
          ) : null}
          {isVision && result.details ? (
            <div className="rounded-[6px] border border-on-surface/8 bg-surface-container-low px-3 py-2 text-[11px] leading-relaxed text-on-surface/70">
              <p>期望结果：{result.details.expected}</p>
              <p>实际返回：{result.details.actual?.trim() ? result.details.actual : "空响应"}</p>
            </div>
          ) : null}
          {!isOk && <p className="text-[10px] font-mono opacity-50">Code: {result.code}</p>}
        </div>
      </motion.div>
    );
  };

  const renderConnectionTestPanel = (
    family: SettingsFamily,
    disabled = false,
    options?: {
      title?: string;
      description?: string;
      buttonLabel?: string;
    },
  ) => (
    <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[12.5px] font-black text-on-surface">{options?.title || "连接测试"}</h3>
          <p className="mt-1 text-[11.5px] font-medium text-ui-muted/65">{options?.description || "验证当前配置的连通性与可用性。"}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleTest(family)}
          loading={testingFamily === family}
          disabled={disabled}
        >
          {disabled ? "仅桌面端可测试" : options?.buttonLabel || "测试连接"}
        </Button>
      </div>
      <div className="mt-3">{renderResult(family)}</div>
    </div>
  );

  const renderSecretField = (
    label: string,
    state: SecretState,
    secret: SecretDraft,
    setSecret: Dispatch<SetStateAction<SecretDraft>>,
  ) => (
    <FieldGroup label={label} hint={describeSecret(state, secret)}>
      <InputShell icon={Key} className="group flex items-center gap-2">
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
          className="flex-1 bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none placeholder:text-on-surface-variant/35"
          placeholder={state === "stored" ? "输入新密钥以替换当前值" : "输入要保存的新密钥"}
        />
        <div className="flex shrink-0 items-center gap-1 pr-1">
          <button
            type="button"
            onClick={() => setSecret((current) => ({ ...current, visible: !current.visible }))}
            className="rounded-[6px] p-2 text-on-surface-variant/45 transition-colors hover:bg-surface-container-low hover:text-on-surface"
            title={secret.visible ? "隐藏" : "显示"}
          >
            {secret.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>

          {secret.action !== "keep" ? (
            <button
              type="button"
              onClick={() => setSecret((current) => ({ ...current, action: "keep", value: "", visible: false }))}
              className="rounded-[6px] px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary/5 transition-colors"
            >
              撤销
            </button>
          ) : state === "stored" ? (
            <button
              type="button"
              onClick={() => setSecret((current) => ({ ...current, action: "clear", value: "", visible: false }))}
              className="rounded-[6px] px-2 py-1 text-[11px] font-bold text-on-surface-variant/60 hover:bg-on-surface/5 transition-colors"
            >
              清空
            </button>
          ) : null}
        </div>
      </InputShell>
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
  const visionMode = getVisionSourceMode(draft.global_config);
  const visionUsesSharedText = visionMode === "shared_text";

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
                        <p className={cn("text-[12.5px] font-black leading-none tracking-tight", active ? "text-primary" : "text-on-surface/80")}>{cat.label}</p>
                        {dirtyTabs[cat.id] ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label={`${cat.label} 有未保存修改`} />
                        ) : null}
                      </div>
                      <p className="mt-1.5 truncate text-[10.5px] font-medium opacity-50">{cat.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-8 rounded-xl border border-on-surface/8 bg-on-surface/[0.02] p-4">
              <div className="flex items-center gap-2 text-primary">
                <Cpu className="h-3.5 w-3.5" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/60">配置健康</span>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <span className="text-[18px] font-black text-on-surface">{configuredHealthCount}/{healthItems.length}</span>
                <span className="text-[10px] font-bold text-on-surface/35">能力已配置</span>
              </div>
              <div className="mt-4 space-y-3">
                {healthItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <item.icon className="h-3 w-3 text-on-surface/25" />
                      <div className="min-w-0">
                        <span className="block truncate text-[11px] font-bold text-on-surface/50">{item.label}</span>
                        <span className="block truncate text-[9.5px] font-semibold text-on-surface/25">{item.description}</span>
                      </div>
                    </div>
                    {item.configured ? (
                      <div className="flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5">
                        <div className="h-0.5 w-0.5 rounded-full bg-success" />
                        <span className="text-[9px] font-black tracking-widest text-success-dim/80">可用</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 rounded-full bg-on-surface/5 px-1.5 py-0.5">
                        <div className="h-0.5 w-0.5 rounded-full bg-on-surface/20" />
                        <span className="text-[9px] font-black tracking-widest text-on-surface/35">{item.optional ? "可选" : "待配置"}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-on-surface/5 pt-3">
                <p className="text-[10px] font-bold leading-relaxed text-on-surface/25">
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
              <div className="mb-6 rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
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
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/55">配置健康</span>
                  <span className="text-[11px] font-bold text-on-surface/50">{configuredHealthCount}/{healthItems.length} 可用</span>
                  {healthItems.map((item) => (
                    <span
                      key={item.label}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold",
                        item.configured ? "bg-success/10 text-success-dim" : "bg-on-surface/5 text-on-surface/35",
                      )}
                    >
                      {item.label}
                    </span>
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
              <div className="mb-6 flex items-center gap-2.5 rounded-[6px] border border-success/15 bg-success/5 px-4 py-3 text-[12.5px] font-bold text-success-dim animate-in fade-in slide-in-from-top-2 duration-300">
                <CheckCircle2 className="h-4 w-4" />
                {success}
              </div>
            )}

            {activeTab === "text" && (
              <SettingsSection
                icon={Layers3}
                title="文本模型与图片理解"
                description="默认只配置文本模型。开启图片理解后，可直接复用当前文本模型，也可以切换成单独的图片理解模型。"
              >
                <PresetSelector
                  label="文本预设"
                  presets={snapshot.families.text.presets.map((item) => ({ id: item.id, name: item.name }))}
                  activeId={snapshot.families.text.active_preset_id}
                  onSwitch={(id) => void handleActivatePreset("text", id)}
                  onAdd={() => handleCreatePreset("text")}
                  onDelete={(preset) => void handleDeletePreset("text", preset.id, preset.name)}
                />
                {textPresetEditable ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <FieldGroup label="模型 ID">
                      <InputShell icon={Terminal}>
                        <input value={draft.text.OPENAI_MODEL} onChange={(event) => updateDraft("text", (current) => ({ ...current, OPENAI_MODEL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none" placeholder="gpt-5.4" />
                      </InputShell>
                    </FieldGroup>
                    <FieldGroup label="接口地址" hint="填写 OpenAI 兼容地址，通常以 /v1 结尾。">
                      <InputShell icon={Globe}>
                        <input value={draft.text.OPENAI_BASE_URL} onChange={(event) => updateDraft("text", (current) => ({ ...current, OPENAI_BASE_URL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://api.openai.com/v1" />
                      </InputShell>
                    </FieldGroup>
                    <div className="xl:col-span-2">{renderSecretField("接口密钥", draft.text.secret_state, textSecret, setTextSecret)}</div>
                    <ProviderCapabilitySummary
                      title="当前连接方式"
                      kind="text"
                      provider={draft.text.provider}
                      apiFormat={draft.text.api_format}
                      toolMode={draft.text.tool_mode}
                      capabilities={draft.text.capabilities}
                    />
                    <div className="xl:col-span-2">
                      {renderConnectionTestPanel("text", false, {
                        title: "文本连接测试",
                        description: "验证当前配置的连通性与可用性。",
                        buttonLabel: "测试文本连接",
                      })}
                    </div>
                  </div>
                ) : (
                  renderCreatePresetHint("文本模型")
                )}
                <div className="mt-6 rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-primary/70" />
                        <h3 className="text-[14px] font-bold text-on-surface">图片理解能力</h3>
                      </div>
                      <p className="mt-1 text-[12px] leading-6 text-on-surface-variant/70">
                        开启后，模型可在必要时查看图片内容；关闭时只按文件名判断。
                      </p>
                    </div>
                    <div className="flex items-center gap-2 rounded-[10px] border border-on-surface/8 bg-surface-container-low px-3 py-2">
                      <span className="text-[12px] font-medium text-on-surface-variant/70">启用</span>
                      <ToggleSwitch
                        checked={Boolean(draft.global_config.IMAGE_ANALYSIS_ENABLED)}
                        onClick={() => updateGlobal("IMAGE_ANALYSIS_ENABLED", !draft.global_config.IMAGE_ANALYSIS_ENABLED)}
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ui-muted">当前来源</p>
                    <div className="mt-2 grid gap-2 xl:grid-cols-2">
                      {([
                        {
                          id: "shared_text" as const,
                          label: "复用文本模型",
                          description: "默认方案，直接使用当前文本模型的端点、模型与密钥。",
                        },
                        {
                          id: "separate" as const,
                          label: "单独图片模型",
                          description: "为图片理解保留独立预设，适合视觉模型与文本模型分开配置。",
                        },
                      ] as const).map((item) => {
                        const active = visionMode === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => updateGlobal("IMAGE_ANALYSIS_SOURCE_MODE", item.id)}
                            className={cn(
                              "rounded-[10px] border px-3 py-3 text-left transition-colors",
                              active
                                ? "border-primary/35 bg-primary/[0.06]"
                                : "border-on-surface/8 bg-surface-container-lowest hover:border-on-surface/16",
                            )}
                          >
                            <div className="text-[12.5px] font-bold text-on-surface">{item.label}</div>
                            <div className="mt-1 text-[11px] leading-relaxed text-ui-muted">{item.description}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {visionUsesSharedText ? (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Layers3 className="h-4 w-4 text-primary/70" />
                          <p className="text-[12.5px] font-bold text-on-surface">当前复用文本模型</p>
                        </div>
                        <div className="mt-3 grid gap-3 xl:grid-cols-2">
                          <div className="rounded-[8px] border border-on-surface/6 bg-surface px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-ui-muted">模型 ID</p>
                            <p className="mt-1 text-[12px] font-semibold text-on-surface">{draft.text.OPENAI_MODEL || "未填写"}</p>
                          </div>
                          <div className="rounded-[8px] border border-on-surface/6 bg-surface px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-ui-muted">接口地址</p>
                            <p className="mt-1 break-all font-mono text-[11px] font-medium text-on-surface">{draft.text.OPENAI_BASE_URL || "未填写"}</p>
                          </div>
                        </div>
                        <p className="mt-3 text-[11px] leading-relaxed text-ui-muted">
                          图片理解测试将复用文本模型的配置，并验证其是否支持图片输入。
                        </p>
                      </div>
                      {renderConnectionTestPanel("vision", false, {
                        title: "图片理解能力测试",
                        description: "验证当前模型是否支持图片理解功能。",
                        buttonLabel: "测试图片理解能力",
                      })}
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <PresetSelector
                        label="图片理解预设"
                        presets={snapshot.families.vision.presets.map((item) => ({ id: item.id, name: item.name }))}
                        activeId={snapshot.families.vision.active_preset_id}
                        onSwitch={(id) => void handleActivatePreset("vision", id)}
                        onAdd={() => handleCreatePreset("vision")}
                        onDelete={(preset) => void handleDeletePreset("vision", preset.id, preset.name)}
                      />
                      {visionPresetEditable ? (
                        <div className="grid gap-4 xl:grid-cols-2">
                          <FieldGroup label="模型 ID">
                            <InputShell icon={ImageIcon}>
                              <input value={draft.vision.IMAGE_ANALYSIS_MODEL} onChange={(event) => updateDraft("vision", (current) => ({ ...current, IMAGE_ANALYSIS_MODEL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none" placeholder="gpt-4o-mini" />
                            </InputShell>
                          </FieldGroup>
                          <FieldGroup label="接口地址" hint="填写 OpenAI 兼容地址，通常以 /v1 结尾；该模型还需要支持图片输入。">
                            <InputShell icon={Globe}>
                              <input value={draft.vision.IMAGE_ANALYSIS_BASE_URL} onChange={(event) => updateDraft("vision", (current) => ({ ...current, IMAGE_ANALYSIS_BASE_URL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://host.example/v1" />
                            </InputShell>
                          </FieldGroup>
                          <div className="xl:col-span-2">{renderSecretField("图片理解密钥", draft.vision.secret_state, visionSecret, setVisionSecret)}</div>
                          <ProviderCapabilitySummary
                            title="当前连接方式"
                            kind="vision"
                            provider={draft.vision.provider}
                            apiFormat={draft.vision.api_format}
                            toolMode={draft.vision.tool_mode}
                            capabilities={draft.vision.capabilities}
                          />
                          <div className="xl:col-span-2">
                            {renderConnectionTestPanel("vision", false, {
                              title: "图片理解能力测试",
                              description: "验证当前图片模型的连通性与可用性。",
                              buttonLabel: "测试图片理解能力",
                            })}
                          </div>
                        </div>
                      ) : (
                        renderCreatePresetHint("图片理解")
                      )}
                    </div>
                  )}
                </div>
              </SettingsSection>
            )}

            {activeTab === "icon_image" && (
              <SettingsSection
                icon={ImageIcon}
                title="图标生成"
                description="配置图标工坊的生图模型及参数。文本分析能力将自动复用当前的整理模型预设。"
              >
                <PresetSelector
                  label="图标生图预设"
                  presets={snapshot.families.icon_image.presets.map((item) => ({ id: item.id, name: item.name }))}
                  activeId={snapshot.families.icon_image.active_preset_id}
                  onSwitch={(id) => void handleActivatePreset("icon_image", id)}
                  onAdd={() => handleCreatePreset("icon_image")}
                  onDelete={(preset) => void handleDeletePreset("icon_image", preset.id, preset.name)}
                />
                {iconImagePresetEditable ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <FieldGroup label="生图模型 ID">
                      <InputShell icon={Terminal}>
                        <input value={draft.icon_image.image_model.model} onChange={(event) => updateDraft("icon_image", (current) => ({ ...current, image_model: { ...current.image_model, model: event.target.value } }))} className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none" placeholder="gpt-image-1" />
                      </InputShell>
                    </FieldGroup>
                    <FieldGroup label="生图接口地址" className="xl:col-span-2" hint="可填写 OpenAI 兼容 /v1 地址，或服务商给出的完整 /images/generations 端点。">
                      <InputShell icon={Globe}>
                        <input value={draft.icon_image.image_model.base_url} onChange={(event) => updateDraft("icon_image", (current) => ({ ...current, image_model: { ...current.image_model, base_url: event.target.value } }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://host.example/v1" />
                      </InputShell>
                    </FieldGroup>
                    <ProviderCapabilitySummary
                      title="当前连接方式"
                      kind="icon_image"
                      provider={draft.icon_image.image_model.provider}
                      apiFormat={draft.icon_image.image_model.api_format}
                      toolMode={draft.icon_image.image_model.tool_mode}
                      capabilities={draft.icon_image.image_model.capabilities}
                    />
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
                          placeholder="2"
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
                        <StrategyOptionButton active={draft.icon_image.save_mode === "centralized"} label="集中保存" onClick={() => updateDraft("icon_image", (current) => ({ ...current, save_mode: "centralized" }))} description="应用后的 .ico 写入 %APPDATA%/FilePilot/managed_icons；预览 PNG 仍保存在项目 output/icon_workbench/previews。" />
                        <StrategyOptionButton active={draft.icon_image.save_mode === "in_folder"} label="就地保存" onClick={() => updateDraft("icon_image", (current) => ({ ...current, save_mode: "in_folder" }))} description="处理后资源靠近目标文件夹，适合边做边核对。" />
                      </div>
                    </FieldGroup>
                    <div className="xl:col-span-2">{renderSecretField("生图接口密钥", draft.icon_image.image_model.secret_state, iconSecret, setIconSecret)}</div>
                    <div className="xl:col-span-2">{renderConnectionTestPanel("icon_image")}</div>
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
                        className="min-h-32 w-full resize-y rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3 font-mono text-[13px] leading-6 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary focus:ring-4 focus:ring-primary/5"
                        placeholder='{"data":[{"path":"{{uploaded_path}}","meta":{"_type":"gradio.FileData"}}],"fn_index":0}'
                      />
                    </FieldGroup>
                  </div>
                )}

                {renderSecretField("Hugging Face Token（可选）", draft.bg_removal.custom.secret_state, bgRemovalSecret, setBgRemovalSecret)}
                {renderConnectionTestPanel("bg_removal", !desktopReady)}
              </SettingsSection>
            )}

            {activeTab === "launch" && (
              <SettingsSection
                icon={SettingsIcon}
                title="新任务默认值"
                description="按启动策略、放置规则和目标目录分开配置，首页会读取这里的默认值。"
              >
                <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
                  <div className="grid gap-2 md:grid-cols-3">
                    {launchSections.map((section) => {
                      const active = activeLaunchSection === section.id;
                      return (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => setActiveLaunchSection(section.id)}
                          className={cn(
                            "flex min-h-[58px] items-center gap-3 rounded-[8px] border px-3 py-2 text-left transition-colors",
                            active
                              ? "border-primary/28 bg-primary/8 text-primary"
                              : "border-on-surface/8 bg-surface-container-lowest text-on-surface hover:border-primary/18 hover:bg-surface-container-low",
                          )}
                        >
                          <section.icon className="h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[12.5px] font-black">{section.label}</p>
                            <p className="mt-1 truncate text-[11px] font-medium text-ui-muted">{section.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {activeLaunchSection === "strategy" && (
                  <div className="space-y-4">
                    <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">{launchTemplate.label}</span>
                        <span className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">{launchStrategyPreview.organize_mode_label}</span>
                        <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">{launchStrategyPreview.language_label}</span>
                        <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">{launchStrategyPreview.density_label}</span>
                        <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">{launchStrategyPreview.prefix_style_label}</span>
                        <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">{launchStrategyPreview.caution_level_label}</span>
                      </div>
                    </div>
                    <FieldGroup label="默认整理方式">
                      <div className="grid gap-3 md:grid-cols-2">
                        <StrategyOptionButton
                          active={launchDefaultOrganizeMethod === "categorize_into_new_structure"}
                          label="生成新的分类结构"
                          description="默认让 AI 为这批内容生成一套新目录，再写入新目录生成位置。"
                          onClick={() => updateGlobal("LAUNCH_DEFAULT_ORGANIZE_METHOD", "categorize_into_new_structure")}
                        />
                        <StrategyOptionButton
                          active={launchDefaultOrganizeMethod === "assign_into_existing_categories"}
                          label="归入已有目录"
                          description="默认把内容归入已保存的目标目录配置；拿不准的项目进入待确认区（不会自动归入目标目录）。"
                          onClick={() => updateGlobal("LAUNCH_DEFAULT_ORGANIZE_METHOD", "assign_into_existing_categories")}
                        />
                      </div>
                    </FieldGroup>
                    <FieldGroup label="默认模板">
                      <div className="grid gap-2 xl:grid-cols-2">
                        {STRATEGY_TEMPLATES.map((template) => (
                          <StrategyOptionButton
                            key={template.id}
                            active={draft.global_config.LAUNCH_DEFAULT_TEMPLATE_ID === template.id}
                            label={template.label}
                            description={template.description}
                            onClick={() => {
                              const suggested = getSuggestedSelection(template.id);
                              updateGlobal("LAUNCH_DEFAULT_TEMPLATE_ID", template.id);
                              updateGlobal("LAUNCH_DEFAULT_LANGUAGE", suggested.language);
                              updateGlobal("LAUNCH_DEFAULT_DENSITY", suggested.density);
                              updateGlobal("LAUNCH_DEFAULT_PREFIX_STYLE", suggested.prefix_style);
                              updateGlobal("LAUNCH_DEFAULT_CAUTION_LEVEL", suggested.caution_level);
                            }}
                          />
                        ))}
                      </div>
                    </FieldGroup>
                    <div className="grid gap-3 xl:grid-cols-4">
                      {[
                        { label: "目录语言", key: "LAUNCH_DEFAULT_LANGUAGE", options: LANGUAGE_OPTIONS },
                        { label: "分类粒度", key: "LAUNCH_DEFAULT_DENSITY", options: DENSITY_OPTIONS },
                        { label: "目录前缀", key: "LAUNCH_DEFAULT_PREFIX_STYLE", options: PREFIX_STYLE_OPTIONS },
                        { label: "归档倾向", key: "LAUNCH_DEFAULT_CAUTION_LEVEL", options: CAUTION_LEVEL_OPTIONS },
                      ].map((group) => (
                        <FieldGroup key={group.key} label={group.label}>
                          <div className="grid gap-1.5">
                            {group.options.map((option) => {
                              const active = draft.global_config[group.key] === option.id;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => updateGlobal(group.key, option.id)}
                                  className={cn(
                                    "rounded-[6px] border px-3 py-2 text-left transition-colors",
                                    active
                                      ? "border-primary/35 bg-primary/[0.06] text-primary"
                                      : "border-on-surface/8 bg-surface-container-lowest text-on-surface hover:border-primary/20",
                                  )}
                                >
                                  <span className="text-[12px] font-black">{option.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </FieldGroup>
                      ))}
                    </div>
                    <FieldGroup label="补充说明">
                      <textarea
                        value={draft.global_config.LAUNCH_DEFAULT_NOTE ?? ""}
                        onChange={(event) => updateGlobal("LAUNCH_DEFAULT_NOTE", event.target.value.slice(0, 200))}
                        className="min-h-24 w-full resize-none rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3 text-[13px] leading-6 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary focus:ring-4 focus:ring-primary/5"
                        placeholder="例如：拿不准的先放待确认区，课程资料尽量按学期整理。"
                      />
                    </FieldGroup>
                  </div>
                )}

                {activeLaunchSection === "placement" && (
                  <div className="space-y-4">
                    <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
                      <div className="mb-4">
                        <h3 className="text-[13px] font-semibold text-on-surface">默认放置规则</h3>
                        <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
                          这里只定义新任务的默认落点；任务页仍然可以按单次任务覆盖。
                        </p>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <FieldGroup label="默认新目录生成位置" hint="留空时，新结构任务默认使用输出目录；归入已有目录任务默认使用当前任务工作区根。">
                          <InputShell icon={FolderOpen}>
                            <input
                              value={launchDefaultNewDirectoryRoot}
                              onChange={(event) => updateGlobal("LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT", event.target.value)}
                              className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                              placeholder="例如：D:/archive/sorted"
                            />
                          </InputShell>
                        </FieldGroup>
                        <FieldGroup
                          label="默认待确认区位置"
                          hint={
                            launchReviewFollowsNewRoot
                              ? `当前会自动跟随新目录位置，默认使用 ${launchDerivedReviewRoot}。`
                              : "只在关闭“跟随新目录位置”后单独生效。"
                          }
                        >
                          <InputShell icon={FolderOpen}>
                            <input
                              value={launchDefaultReviewRoot}
                              onChange={(event) => updateGlobal("LAUNCH_DEFAULT_REVIEW_ROOT", event.target.value)}
                              disabled={launchReviewFollowsNewRoot}
                              className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none disabled:opacity-60"
                              placeholder={launchReviewFollowsNewRoot ? launchDerivedReviewRoot : "例如：D:/archive/review"}
                            />
                          </InputShell>
                        </FieldGroup>
                      </div>
                      <div className="mt-4 rounded-[12px] border border-on-surface/8 bg-surface-container-low px-4 py-3.5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-[13px] font-semibold text-on-surface">待确认区跟随新目录位置</h3>
                            <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
                              开启后，待确认区默认派生为 `新目录生成位置/Review`。它只作为暂存落点，不会再自动拆分子目录。
                            </p>
                          </div>
                          <ToggleSwitch
                            checked={launchReviewFollowsNewRoot}
                            onClick={() => updateGlobal("LAUNCH_REVIEW_FOLLOWS_NEW_ROOT", !launchReviewFollowsNewRoot)}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-3.5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-[13px] font-semibold text-on-surface">直接使用默认值启动</h3>
                          <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">开启后，首页点击开始时直接进入任务。</p>
                        </div>
                        <ToggleSwitch checked={Boolean(draft.global_config.LAUNCH_SKIP_STRATEGY_PROMPT)} onClick={() => updateGlobal("LAUNCH_SKIP_STRATEGY_PROMPT", !draft.global_config.LAUNCH_SKIP_STRATEGY_PROMPT)} />
                      </div>
                    </div>
                  </div>
                )}

                {activeLaunchSection === "targets" && (
                  <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-[13px] font-semibold text-on-surface">目标目录配置</h3>
                        <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
                          “归入已有目录”会使用这里保存的目录。可以直接把文件夹拖到对应配置里添加。
                        </p>
                      </div>
                      {targetProfilesLoading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : null}
                    </div>
                    <div className="mb-4 space-y-3">
                      <div className="rounded-[10px] border border-primary/12 bg-primary/[0.035] px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-[12.5px] font-black text-on-surface">默认目标目录配置</h3>
                            <p className="mt-1 text-[11.5px] font-medium leading-5 text-ui-muted/70">
                              当“默认整理方式”为“归入已有目录”时，首页会优先选中这组目录。
                            </p>
                          </div>
                          <select
                            value={launchDefaultTargetProfileId}
                            onChange={(event) => updateGlobal("LAUNCH_DEFAULT_TARGET_PROFILE_ID", event.target.value)}
                            disabled={targetProfilesLoading || targetProfiles.length === 0}
                            className="h-9 min-w-[220px] rounded-[8px] border border-on-surface/8 bg-surface px-3 text-[12px] font-semibold text-on-surface outline-none transition-colors focus:border-primary/40 disabled:opacity-60"
                          >
                            <option value="">不指定默认配置</option>
                            {targetProfiles.map((profile) => (
                              <option key={profile.profile_id} value={profile.profile_id}>
                                {profile.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        {launchDefaultTargetProfile ? (
                          <p className="mt-2 text-[11px] font-medium text-primary/70">
                            当前默认：{launchDefaultTargetProfile.name} · {launchDefaultTargetProfile.directories.length} 个目录
                          </p>
                        ) : null}
                      </div>
                      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                        <div ref={targetProfileSelectorRef} className="relative">
                          <button
                            type="button"
                            onClick={() => setTargetProfileSelectorOpen((current) => !current)}
                            disabled={targetProfilesLoading || targetProfiles.length === 0}
                            className={cn(
                              "flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[10px] border px-4 py-2.5 text-left transition-colors",
                              targetProfileSelectorOpen
                                ? "border-primary/35 bg-primary/[0.05]"
                                : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/20 hover:bg-surface-container-low",
                              (targetProfilesLoading || targetProfiles.length === 0) && "cursor-not-allowed opacity-60",
                            )}
                            aria-expanded={targetProfileSelectorOpen}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-primary/14 bg-primary/8 text-primary">
                                <FolderOpen className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-black text-on-surface">{selectedTargetProfileName}</div>
                                <div className="mt-0.5 text-[11px] font-medium text-ui-muted/65">
                                  {targetProfiles.length ? `${selectedTargetDirectoryCount} 个目录 · 共 ${targetProfiles.length} 个配置` : "还没有可用配置"}
                                </div>
                              </div>
                            </div>
                            <ChevronDown className={cn("h-4 w-4 shrink-0 text-ui-muted transition-transform", targetProfileSelectorOpen && "rotate-180 text-primary")} />
                          </button>

                          <div
                            className={cn(
                              "absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-[10px] border border-on-surface/10 bg-surface-container-lowest shadow-xl shadow-black/20 transition-[opacity,transform,max-height]",
                              targetProfileSelectorOpen ? "max-h-[280px] translate-y-0 opacity-100" : "pointer-events-none max-h-0 -translate-y-1 opacity-0",
                            )}
                          >
                            <div className="max-h-[280px] overflow-y-auto p-1.5 scrollbar-thin">
                              {targetProfiles.map((profile) => {
                                const profileDraft = targetProfileDrafts[profile.profile_id];
                                const directoryCount = profileDraft?.directories.length ?? profile.directories.length;
                                const selected = selectedTargetProfile?.profile_id === profile.profile_id;
                                return (
                                  <div
                                    key={profile.profile_id}
                                    className={cn(
                                      "group flex items-center justify-between gap-1 rounded-[8px] px-1 py-1 transition-colors",
                                      selected ? "bg-primary/10" : "hover:bg-on-surface/[0.04]"
                                    )}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedTargetProfileId(profile.profile_id);
                                        setTargetProfileSelectorOpen(false);
                                      }}
                                      className="flex-1 min-w-0 px-2 py-1.5 text-left"
                                    >
                                      <div className="flex items-center gap-2">
                                        <div className="truncate text-[12.5px] font-black">{profileDraft?.name || profile.name}</div>
                                        {selected ? <CheckCircle2 className="h-3 w-3 shrink-0 text-primary" /> : null}
                                      </div>
                                      <div className="mt-0.5 text-[10.5px] font-medium text-ui-muted/65">{directoryCount} 个目录</div>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPendingDeleteTargetProfileId(profile.profile_id);
                                      }}
                                      className="h-8 w-8 shrink-0 flex items-center justify-center rounded-md text-on-surface/20 hover:bg-error/10 hover:text-error transition-all"
                                      title="删除配置"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setCreatingTargetProfile((current) => !current)}
                          disabled={targetProfilesLoading}
                          className="min-h-[52px] px-5"
                        >
                          <FolderPlus className="mr-2 h-4 w-4" />
                          新建配置
                        </Button>
                      </div>

                      <AnimatePresence initial={false}>
                        {creatingTargetProfile && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="grid gap-2 rounded-[10px] border border-primary/14 bg-primary/[0.035] p-3 xl:grid-cols-[minmax(0,1fr)_auto_auto]">
                              <InputShell icon={FolderPlus}>
                                <input
                                  value={newTargetProfileName}
                                  onChange={(event) => setNewTargetProfileName(event.target.value)}
                                  className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                                  placeholder="例如：下载目录的归档"
                                  autoFocus
                                />
                              </InputShell>
                              <Button type="button" variant="secondary" onClick={() => setCreatingTargetProfile(false)} disabled={targetProfilesLoading}>
                                取消
                              </Button>
                              <Button type="button" onClick={() => void createTargetProfile()} disabled={targetProfilesLoading || !newTargetProfileName.trim()}>
                                创建并切换
                              </Button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="grid gap-3">
                      {selectedTargetProfile ? (() => {
                        const profile = selectedTargetProfile;
                        const profileDraft = targetProfileDrafts[profile.profile_id] ?? {
                          name: profile.name,
                          directories: profile.directories,
                          newPath: "",
                          newLabel: "",
                          newDescription: "",
                        };
                        const dragActive = dragTargetProfileId === profile.profile_id;
                        return (
                          <div
                            key={profile.profile_id}
                            ref={(element) => {
                              targetDropZoneRefs.current[profile.profile_id] = element;
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              setDragTargetProfileId(profile.profile_id);
                            }}
                            onDragLeave={() => setDragTargetProfileId((current) => (current === profile.profile_id ? null : current))}
                            onDrop={(event) => {
                              event.preventDefault();
                              setDragTargetProfileId(null);
                              addDirectoriesToTargetProfile(profile.profile_id, extractDroppedPaths(event));
                            }}
                            className={cn(
                              "rounded-[12px] border px-4 py-3 transition-colors",
                              dragActive
                                ? "border-primary/45 bg-primary/[0.06]"
                                : "border-on-surface/8 bg-surface-container-lowest",
                            )}
                          >
                            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                              <FieldGroup label="当前配置名称">
                                <input
                                  value={profileDraft.name}
                                  onChange={(event) => updateTargetProfileDraft(profile.profile_id, (current) => ({ ...current, name: event.target.value }))}
                                  className="h-10 w-full rounded-[8px] border border-on-surface/8 bg-surface px-3 text-[13px] font-semibold text-on-surface outline-none focus:border-primary/40"
                                  placeholder="配置名称"
                                />
                              </FieldGroup>
                              <div className="flex items-end gap-2">
                                <Button type="button" variant="ghost" onClick={() => void deleteTargetProfile(profile.profile_id)} disabled={targetProfilesLoading}>
                                  删除配置
                                </Button>
                              </div>
                            </div>
                            <div className="mt-3 rounded-[8px] border border-dashed border-on-surface/10 bg-surface px-3 py-2 text-[11px] font-semibold text-ui-muted">
                              拖入文件夹即可加入此配置
                            </div>
                            <div className="mt-3 grid gap-2">
                              {profileDraft.directories.length ? profileDraft.directories.map((directory) => (
                                <div key={directory.path} className="rounded-[8px] border border-on-surface/8 bg-surface px-3 py-3">
                                  {(() => {
                                    const editorKey = targetDirectoryEditorKey(profile.profile_id, directory.path);
                                    const isExpanded = expandedTargetDirectoryEditors[editorKey] ?? false;
                                    const hasSemanticHint = Boolean((directory.label || "").trim() || (directory.description || "").trim());
                                    return (
                                      <>
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0">
                                            <div className="truncate text-[12.5px] font-bold text-on-surface">{directory.label || directory.path.split(/[\\/]/).pop() || directory.path}</div>
                                            <div className="truncate font-mono text-[10.5px] text-ui-muted/60" title={directory.path}>{directory.path}</div>
                                            {directory.label ? (
                                              <div className="mt-1 inline-flex rounded-[5px] bg-primary/[0.06] px-2 py-0.5 text-[10px] font-bold text-primary">
                                                标签：{directory.label}
                                              </div>
                                            ) : null}
                                            {directory.description ? (
                                              <div className="mt-1 text-[11px] leading-relaxed text-ui-muted">{directory.description}</div>
                                            ) : !directory.label ? (
                                              <div className="mt-1 text-[11px] leading-relaxed text-ui-muted/55">
                                                暂未补充标签和目录说明。
                                              </div>
                                            ) : null}
                                          </div>
                                          <div className="flex shrink-0 items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => setExpandedTargetDirectoryEditors((current) => ({ ...current, [editorKey]: !isExpanded }))}
                                              disabled={targetProfilesLoading}
                                              className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                                            >
                                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                              {hasSemanticHint ? "编辑标签和说明" : "补充标签和说明"}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => removeDirectoryFromTargetProfile(profile.profile_id, directory.path)}
                                              disabled={targetProfilesLoading}
                                              className="rounded-[6px] px-2 py-1 text-[11px] font-bold text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                                            >
                                              移除
                                            </button>
                                          </div>
                                        </div>
                                        {isExpanded ? (
                                          <div className="mt-3 grid gap-2 xl:grid-cols-[180px_minmax(0,1fr)]">
                                            <input
                                              value={directory.label || ""}
                                              onChange={(event) =>
                                                updateTargetProfileDraft(profile.profile_id, (current) => ({
                                                  ...current,
                                                  directories: current.directories.map((item) => (
                                                    item.path === directory.path
                                                      ? { ...item, label: event.target.value }
                                                      : item
                                                  )),
                                                }))
                                              }
                                              className="h-9 rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-3 text-[12px] text-on-surface outline-none focus:border-primary/40"
                                              placeholder="标签（可选）"
                                            />
                                            <input
                                              value={directory.description || ""}
                                              onChange={(event) =>
                                                updateTargetProfileDraft(profile.profile_id, (current) => ({
                                                  ...current,
                                                  directories: current.directories.map((item) => (
                                                    item.path === directory.path
                                                      ? { ...item, description: event.target.value }
                                                      : item
                                                  )),
                                                }))
                                              }
                                              className="h-9 rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-3 text-[12px] text-on-surface outline-none focus:border-primary/40"
                                              placeholder="目录说明（可选，用来提示该目录适合收什么）"
                                            />
                                          </div>
                                        ) : null}
                                      </>
                                    );
                                  })()}
                                </div>
                              )) : (
                                <div className="rounded-[8px] border border-dashed border-on-surface/10 bg-surface px-3 py-3 text-[12px] font-medium text-ui-muted">
                                  这个配置还没有目录。
                                </div>
                              )}
                            </div>
                            <div className="mt-3 grid gap-2 xl:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_auto]">
                              <input
                                value={profileDraft.newPath}
                                onChange={(event) => updateTargetProfileDraft(profile.profile_id, (current) => ({ ...current, newPath: event.target.value }))}
                                className="h-9 rounded-[8px] border border-on-surface/8 bg-surface px-3 font-mono text-[12px] text-on-surface outline-none focus:border-primary/40"
                                placeholder="目标目录完整路径，例如 D:/archive/docs"
                              />
                              <input
                                value={profileDraft.newLabel}
                                onChange={(event) => updateTargetProfileDraft(profile.profile_id, (current) => ({ ...current, newLabel: event.target.value }))}
                                className="h-9 rounded-[8px] border border-on-surface/8 bg-surface px-3 text-[12px] text-on-surface outline-none focus:border-primary/40"
                                placeholder="标签（可选）"
                              />
                              <input
                                value={profileDraft.newDescription}
                                onChange={(event) => updateTargetProfileDraft(profile.profile_id, (current) => ({ ...current, newDescription: event.target.value }))}
                                className="h-9 rounded-[8px] border border-on-surface/8 bg-surface px-3 text-[12px] text-on-surface outline-none focus:border-primary/40"
                                placeholder="目录说明（可选）"
                              />
                              <Button type="button" variant="secondary" onClick={() => addDirectoryToTargetProfile(profile.profile_id)} disabled={targetProfilesLoading || !profileDraft.newPath.trim()}>
                                添加目录
                              </Button>
                            </div>
                          </div>
                        );
                      })() : (
                        <div className="rounded-[12px] border border-dashed border-on-surface/10 bg-surface-container-lowest px-4 py-6 text-center text-[13px] font-medium text-ui-muted">
                          还没有目标目录配置。新建一个配置后，在启动页选择“归入现有目录”即可复用。
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </SettingsSection>
            )}

            {activeTab === "system" && (
              <SettingsSection
                icon={ShieldCheck}
                title="运行与日志"
                description="只保留常用的运行和日志开关，避免把这里变成调试控制台。"
              >
                <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
                  <div className="mb-4">
                    <h3 className="text-[13px] font-semibold text-on-surface">日志输出路径</h3>
                    <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
                      运行日志始终会写入以下目录。开启“详细日志”后，还会额外输出调试明细。
                    </p>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {[
                      {
                        label: "运行日志",
                        path: snapshot?.runtime.log_paths.runtime_log || "",
                      },
                      {
                        label: "调试日志",
                        path: snapshot?.runtime.log_paths.debug_log || "",
                      },
                    ].map((item) => (
                      <div key={item.label} className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] font-black uppercase tracking-[0.15em] text-ui-muted">{item.label}</span>
                          <button
                            type="button"
                            onClick={() => copyTextToClipboard(item.path, setSuccess, setError)}
                            className="inline-flex items-center gap-1 rounded-[6px] border border-on-surface/8 bg-surface px-2.5 py-1 text-[11px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary"
                          >
                            <ClipboardCopy className="h-3 w-3" />
                            复制
                          </button>
                        </div>
                        <div className="mt-2 break-all font-mono text-[12px] leading-5 text-on-surface/70">
                          {item.path || "尚未生成"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
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
                  <span className="text-[10px] font-medium text-on-surface/40">
                    {dirtyTabLabels.length ? `将保存：${dirtyTabLabels.join("、")}` : "会保存本页未提交的修改"}
                  </span>
                </div>
                <div className="h-8 w-px bg-primary/10" />
                <Button variant="secondary" onClick={discardChanges} disabled={saving} className="h-9 px-4 text-[12.5px] font-bold">
                  放弃修改
                </Button>
                <Button onClick={() => void handleSave()} loading={saving} disabled={saving} className="h-9 px-5 text-[12.5px] font-bold border border-primary/20 bg-primary active:bg-primary-dim">
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
                  if (!dialog) {
                    return;
                  }
                  setCreatePresetDialog(null);
                  await performCreatePreset(dialog.family, dialog.value);
                })();
              }
            }}
            className="w-full rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3 text-[14px] font-semibold text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary focus:ring-4 focus:ring-primary/5"
            placeholder="请输入预设名称"
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
      <ConfirmDialog
        open={Boolean(pendingDeleteTargetProfileId)}
        title="删除目标配置"
        description="确定要删除这个目标目录配置吗？删除后将无法通过此配置快速归档文件。"
        confirmLabel="确认删除"
        cancelLabel="取消"
        tone="danger"
        loading={targetProfilesLoading}
        onConfirm={async () => {
          if (!pendingDeleteTargetProfileId) return;
          const id = pendingDeleteTargetProfileId;
          setPendingDeleteTargetProfileId(null);
          await deleteTargetProfile(id);
        }}
        onCancel={() => setPendingDeleteTargetProfileId(null)}
      />
    </div>
  );
}
