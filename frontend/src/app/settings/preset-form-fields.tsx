"use client";

import type { Dispatch, SetStateAction } from "react";
import { motion } from "motion/react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Key,
  Loader2,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldGroup, InputShell } from "@/components/settings/settings-primitives";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { cn } from "@/lib/utils";
import {
  describeConnectionIssue,
  describeSecret,
  type ModelLookupState,
  type PresetConfigFamily,
  type SecretDraft,
} from "@/app/settings/settings-draft";
import type {
  ProviderCapabilities,
  SecretState,
  SettingsFamily,
  SettingsModelListResult,
  SettingsTestResult,
} from "@/types/settings";

export type ProviderSummaryKind = "text" | "vision" | "icon_image";

/** 页面级连接测试状态与回调的分组 props，供各 Tab 组件透传。 */
export interface ConnectionTestControls {
  testingFamily: SettingsFamily | null;
  results: Partial<Record<SettingsFamily, SettingsTestResult>>;
  onTest: (family: SettingsFamily) => void;
}

/** 页面级模型列表拉取状态与回调的分组 props，供各 Tab 组件透传。 */
export interface ModelLookupControls {
  results: ModelLookupState;
  loadingFamily: PresetConfigFamily | null;
  onFetch: (family: PresetConfigFamily) => void;
}

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

export interface ProviderCapabilitySummaryProps {
  title: string;
  kind: ProviderSummaryKind;
  provider?: string;
  apiFormat?: string;
  toolMode?: string;
  capabilities?: ProviderCapabilities;
}

export function ProviderCapabilitySummary({
  title,
  kind,
  provider,
  apiFormat,
}: ProviderCapabilitySummaryProps) {
  const serviceLabel = formatProviderLabel(provider);
  const formatLabel = kind === "icon_image" ? "图像生成接口" : formatApiFormatLabel(apiFormat);
  const hint =
    kind === "icon_image"
      ? "OpenAI 兼容 /images 生图；保存后可测试连接"
      : "OpenAI 兼容聊天接口；保存后可测试连接";

  return (
    <div
      className="xl:col-span-2 flex flex-wrap items-center gap-2 rounded-[6px] border border-on-surface/6 bg-surface-container-lowest/70 px-3 py-2 text-[12px]"
      title={hint}
    >
      <div className="flex min-w-0 items-center gap-2 pr-1">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary/65" />
        <span className="shrink-0 font-bold text-on-surface-variant/65">{title}</span>
        <span className="truncate font-semibold text-on-surface/85">
          {serviceLabel} · {formatLabel}
        </span>
      </div>
      <span className="rounded-[6px] border border-on-surface/8 bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-on-surface-variant/55">
        保存后可测试
      </span>
    </div>
  );
}

export interface ConnectionTestResultProps {
  family: SettingsFamily;
  result?: SettingsTestResult;
  isTesting: boolean;
}

export function ConnectionTestResult({ family, result, isTesting }: ConnectionTestResultProps) {
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
          <p className="mt-0.5 text-[11px] font-bold tracking-widest text-primary/60">
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
            <div className="flex items-center gap-1.5 rounded-[4px] bg-success/10 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-success-dim">
              <div className="h-1 w-1 rounded-full bg-success animate-pulse" />
              可用
            </div>
          )}
        </div>
        <p className="text-[12px] leading-relaxed text-on-surface/70">{result.message}</p>
        {!isOk && issueHint ? (
          <p className="rounded-[6px] border border-error/10 bg-error/[0.04] px-3 py-2 text-[12px] font-medium leading-relaxed text-error-dim">
            {issueHint}
          </p>
        ) : null}
        {isVision && result.details ? (
          <div className="rounded-[6px] border border-on-surface/8 bg-surface-container-low px-3 py-2 text-[11px] leading-relaxed text-on-surface/70">
            <p>期望结果：{result.details.expected}</p>
            <p>实际返回：{result.details.actual?.trim() ? result.details.actual : "空响应"}</p>
          </div>
        ) : null}
        {!isOk && <p className="text-[11px] font-mono opacity-50">Code: {result.code}</p>}
      </div>
    </motion.div>
  );
}

export interface ConnectionTestPanelProps {
  family: SettingsFamily;
  disabled?: boolean;
  title?: string;
  description?: string;
  buttonLabel?: string;
  isTesting: boolean;
  result?: SettingsTestResult;
  onTest: () => void;
}

export function ConnectionTestPanel({
  family,
  disabled = false,
  title,
  description,
  buttonLabel,
  isTesting,
  result,
  onTest,
}: ConnectionTestPanelProps) {
  return (
    <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-black text-on-surface">{title || "连接测试"}</h3>
          <p className="mt-1 text-[12px] font-medium text-ui-muted/65">{description || "验证当前配置的连通性与可用性。"}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onTest}
          loading={isTesting}
          disabled={disabled}
        >
          {disabled ? "仅桌面端可测试" : buttonLabel || "测试连接"}
        </Button>
      </div>
      <div className="mt-3">
        <ConnectionTestResult family={family} result={result} isTesting={isTesting} />
      </div>
    </div>
  );
}

export interface ModelIdFieldProps {
  label: string;
  icon: LucideIcon;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  className?: string;
  lookupResult?: SettingsModelListResult;
  isLoadingModels: boolean;
  onFetchModels: () => void;
}

export function ModelIdField({
  label,
  icon,
  value,
  placeholder,
  onChange,
  className,
  lookupResult,
  isLoadingModels,
  onFetchModels,
}: ModelIdFieldProps) {
  const models = lookupResult?.models || [];
  return (
    <FieldGroup label={label} className={className}>
      <InputShell icon={icon} className="flex items-center gap-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={onFetchModels}
          disabled={isLoadingModels}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border border-on-surface/8 bg-surface px-2.5 text-[11px] font-bold text-on-surface/70 transition-colors hover:border-primary/20 hover:text-primary disabled:opacity-55"
        >
          {isLoadingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          获取
        </button>
      </InputShell>
      {lookupResult ? (
        <div
          className={cn(
            "rounded-[6px] border px-2.5 py-2",
            lookupResult.status === "ok"
              ? "border-on-surface/8 bg-surface-container-lowest"
              : "border-error/15 bg-error/[0.03]",
          )}
        >
          {lookupResult.status === "ok" ? (
            models.length ? (
              <div className="flex flex-wrap gap-1.5">
                {models.slice(0, 8).map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => onChange(model.id)}
                    className={cn(
                      "max-w-full truncate rounded-[6px] border px-2 py-1 text-[11px] font-semibold transition-colors",
                      model.id === value
                        ? "border-primary/25 bg-primary/10 text-primary"
                        : "border-on-surface/8 bg-surface text-on-surface/70 hover:border-primary/18 hover:text-primary",
                    )}
                    title={model.id}
                  >
                    {model.id}
                  </button>
                ))}
                {models.length > 8 ? (
                  <span className="rounded-[6px] border border-on-surface/8 bg-surface px-2 py-1 text-[11px] font-semibold text-ui-muted">
                    +{models.length - 8}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="text-[12px] font-medium text-ui-muted">端点已响应，但没有返回可选模型。</p>
            )
          ) : (
            <p className="text-[12px] font-medium leading-relaxed text-error-dim">
              {lookupResult.message || "获取模型列表失败，请检查端点和密钥。"}
            </p>
          )}
        </div>
      ) : null}
    </FieldGroup>
  );
}

export interface SecretFieldProps {
  label: string;
  state: SecretState;
  secret: SecretDraft;
  setSecret: Dispatch<SetStateAction<SecretDraft>>;
  family: SettingsFamily;
}

export function SecretField({ label, state, secret, setSecret, family }: SecretFieldProps) {
  return (
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
            onClick={async () => {
              const willBeVisible = !secret.visible;
              if (willBeVisible && state === "stored" && (secret.value === "" || secret.value === "********")) {
                try {
                  const res = await fetch(`${getApiBaseUrl()}/api/settings/runtime/${family}`, {
                    headers: getApiToken() ? { "Authorization": `Bearer ${getApiToken()}` } : {},
                  });
                  if (res.ok) {
                    const data = await res.json();
                    let fetchedKey = "";
                    if (family === "text") {
                      fetchedKey = data.api_key || "";
                    } else if (family === "vision") {
                      fetchedKey = data.api_key || "";
                    } else if (family === "icon_image") {
                      fetchedKey = data.image_model?.api_key || "";
                    } else if (family === "bg_removal") {
                      fetchedKey = data.api_token || "";
                    }
                    setSecret((current) => ({
                      ...current,
                      value: fetchedKey,
                      visible: true,
                    }));
                    return;
                  }
                } catch (e) {
                  console.error("Failed to fetch plain secret:", e);
                }
              }
              setSecret((current) => ({ ...current, visible: willBeVisible }));
            }}
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
}

export function SettingsMinPath({ items }: { items: string[] }) {
  return (
    <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/55">最小配置路径</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[12px] leading-5 text-on-surface/70">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary/50" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
