"use client";

import type { Dispatch, SetStateAction } from "react";
import { Globe, ImageIcon, Layers3, Terminal } from "lucide-react";

import {
  FieldGroup,
  InputShell,
  PresetSelector,
  SettingsSection,
  ToggleSwitch,
  type PresetItem,
} from "@/components/settings/settings-primitives";
import { isEditablePreset } from "@/app/settings/preset-flow";
import {
  ConnectionTestPanel,
  ModelIdField,
  ProviderCapabilitySummary,
  SecretField,
  SettingsMinPath,
  type ConnectionTestControls,
  type ModelLookupControls,
} from "@/app/settings/preset-form-fields";
import type { SecretDraft } from "@/app/settings/settings-draft";
import { cn } from "@/lib/utils";
import type { TextSettingsPreset, VisionSettingsPreset, VisionSourceMode } from "@/types/settings";

export interface TextTabProps {
  textDraft: TextSettingsPreset;
  visionDraft: VisionSettingsPreset;
  visionEnabled: boolean;
  visionMode: VisionSourceMode;
  textPresets: PresetItem[];
  textActivePresetId: string;
  visionPresets: PresetItem[];
  visionActivePresetId: string;
  textSecret: SecretDraft;
  setTextSecret: Dispatch<SetStateAction<SecretDraft>>;
  visionSecret: SecretDraft;
  setVisionSecret: Dispatch<SetStateAction<SecretDraft>>;
  onUpdateText: (updater: (current: TextSettingsPreset) => TextSettingsPreset) => void;
  onUpdateVision: (updater: (current: VisionSettingsPreset) => VisionSettingsPreset) => void;
  onUpdateGlobal: (key: string, value: unknown) => void;
  onActivatePreset: (family: "text" | "vision", presetId: string) => void;
  onCreatePreset: (family: "text" | "vision") => void;
  onDeletePreset: (family: "text" | "vision", presetId: string, presetName: string) => void;
  connectionTest: ConnectionTestControls;
  modelLookup: ModelLookupControls;
}

export function TextTab({
  textDraft,
  visionDraft,
  visionEnabled,
  visionMode,
  textPresets,
  textActivePresetId,
  visionPresets,
  visionActivePresetId,
  textSecret,
  setTextSecret,
  visionSecret,
  setVisionSecret,
  onUpdateText,
  onUpdateVision,
  onUpdateGlobal,
  onActivatePreset,
  onCreatePreset,
  onDeletePreset,
  connectionTest,
  modelLookup,
}: TextTabProps) {
  const textPresetEditable = isEditablePreset(textActivePresetId);
  const visionPresetEditable = isEditablePreset(visionActivePresetId);
  const visionUsesSharedText = visionMode === "shared_text";

  return (
    <SettingsSection
      icon={Layers3}
      title="文本模型与图片理解"
      description="配置文本分析模型与可选的图片理解模型。"
    >
      <SettingsMinPath
        items={[
          "文本：接口地址 + 模型 ID + API Key（整理主链路必需）",
          "图片理解默认复用文本模型；仅当视觉模型不同时再选「单独图片模型」",
          "填写后点「测试连接」确认可用；多套环境可用上方预设切换",
        ]}
      />
      <PresetSelector
        label="文本预设"
        presets={textPresets}
        activeId={textActivePresetId}
        onSwitch={(id) => onActivatePreset("text", id)}
        onAdd={() => onCreatePreset("text")}
        onDelete={(preset) => onDeletePreset("text", preset.id, preset.name)}
      />
      {!textPresetEditable ? (
        <p className="text-[11px] leading-5 text-ui-muted">
          尚未保存过预设：可直接填写下方字段，首次保存时会自动创建可编辑预设。
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <ModelIdField
          label="模型 ID"
          icon={Terminal}
          value={textDraft.OPENAI_MODEL}
          placeholder="gpt-5.4"
          onChange={(value) => onUpdateText((current) => ({ ...current, OPENAI_MODEL: value }))}
          lookupResult={modelLookup.results.text}
          isLoadingModels={modelLookup.loadingFamily === "text"}
          onFetchModels={() => modelLookup.onFetch("text")}
        />
        <FieldGroup label="接口地址" hint="填写 OpenAI 兼容地址，通常以 /v1 结尾。">
          <InputShell icon={Globe}>
            <input value={textDraft.OPENAI_BASE_URL} onChange={(event) => onUpdateText((current) => ({ ...current, OPENAI_BASE_URL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://api.openai.com/v1" />
          </InputShell>
        </FieldGroup>
        <div className="xl:col-span-2">
          <SecretField label="接口密钥" state={textDraft.secret_state} secret={textSecret} setSecret={setTextSecret} family="text" />
        </div>
        <ProviderCapabilitySummary
          title="当前连接方式"
          kind="text"
          provider={textDraft.provider}
          apiFormat={textDraft.api_format}
          toolMode={textDraft.tool_mode}
          capabilities={textDraft.capabilities}
        />
        <div className="xl:col-span-2">
          <ConnectionTestPanel
            family="text"
            title="文本连接测试"
            description="验证当前配置的连通性与可用性。"
            buttonLabel="测试文本连接"
            isTesting={connectionTest.testingFamily === "text"}
            result={connectionTest.results.text}
            onTest={() => connectionTest.onTest("text")}
          />
        </div>
      </div>
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
          <div className="flex items-center gap-2 rounded-[8px] border border-on-surface/8 bg-surface-container-low px-3 py-2">
            <span className="text-[12px] font-medium text-on-surface-variant/70">启用</span>
            <ToggleSwitch
              checked={visionEnabled}
              onClick={() => onUpdateGlobal("IMAGE_ANALYSIS_ENABLED", !visionEnabled)}
              ariaLabel="启用图片理解能力"
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
                  onClick={() => onUpdateGlobal("IMAGE_ANALYSIS_SOURCE_MODE", item.id)}
                  className={cn(
                    "rounded-[8px] border px-3 py-3 text-left transition-colors",
                    active
                      ? "border-primary/35 bg-primary/[0.06]"
                      : "border-on-surface/8 bg-surface-container-lowest hover:border-on-surface/16",
                  )}
                >
                  <div className="text-[13px] font-bold text-on-surface">{item.label}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-ui-muted">{item.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        {visionUsesSharedText ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
              <div className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-primary/70" />
                <p className="text-[13px] font-bold text-on-surface">当前复用文本模型</p>
              </div>
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                <div className="rounded-[8px] border border-on-surface/6 bg-surface px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ui-muted">模型 ID</p>
                  <p className="mt-1 text-[12px] font-semibold text-on-surface">{textDraft.OPENAI_MODEL || "未填写"}</p>
                </div>
                <div className="rounded-[8px] border border-on-surface/6 bg-surface px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ui-muted">接口地址</p>
                  <p className="mt-1 break-all font-mono text-[11px] font-medium text-on-surface">{textDraft.OPENAI_BASE_URL || "未填写"}</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ui-muted">
                图片理解测试将复用文本模型的配置，并验证其是否支持图片输入。
              </p>
            </div>
            <ConnectionTestPanel
              family="vision"
              title="图片理解能力测试"
              description="验证当前模型是否支持图片理解功能。"
              buttonLabel="测试图片理解能力"
              isTesting={connectionTest.testingFamily === "vision"}
              result={connectionTest.results.vision}
              onTest={() => connectionTest.onTest("vision")}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <PresetSelector
              label="图片理解预设"
              presets={visionPresets}
              activeId={visionActivePresetId}
              onSwitch={(id) => onActivatePreset("vision", id)}
              onAdd={() => onCreatePreset("vision")}
              onDelete={(preset) => onDeletePreset("vision", preset.id, preset.name)}
            />
            {!visionPresetEditable ? (
              <p className="text-[11px] leading-5 text-ui-muted">
                可直接填写下方字段；首次保存时会自动创建图片理解预设。
              </p>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-2">
              <ModelIdField
                label="模型 ID"
                icon={ImageIcon}
                value={visionDraft.IMAGE_ANALYSIS_MODEL}
                placeholder="gpt-4o-mini"
                onChange={(value) => onUpdateVision((current) => ({ ...current, IMAGE_ANALYSIS_MODEL: value }))}
                lookupResult={modelLookup.results.vision}
                isLoadingModels={modelLookup.loadingFamily === "vision"}
                onFetchModels={() => modelLookup.onFetch("vision")}
              />
              <FieldGroup label="接口地址" hint="填写 OpenAI 兼容地址，通常以 /v1 结尾；该模型还需要支持图片输入。">
                <InputShell icon={Globe}>
                  <input value={visionDraft.IMAGE_ANALYSIS_BASE_URL} onChange={(event) => onUpdateVision((current) => ({ ...current, IMAGE_ANALYSIS_BASE_URL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://host.example/v1" />
                </InputShell>
              </FieldGroup>
              <div className="xl:col-span-2">
                <SecretField label="图片理解密钥" state={visionDraft.secret_state} secret={visionSecret} setSecret={setVisionSecret} family="vision" />
              </div>
              <ProviderCapabilitySummary
                title="当前连接方式"
                kind="vision"
                provider={visionDraft.provider}
                apiFormat={visionDraft.api_format}
                toolMode={visionDraft.tool_mode}
                capabilities={visionDraft.capabilities}
              />
              <div className="xl:col-span-2">
                <ConnectionTestPanel
                  family="vision"
                  title="图片理解能力测试"
                  description="验证当前图片模型的连通性与可用性。"
                  buttonLabel="测试图片理解能力"
                  isTesting={connectionTest.testingFamily === "vision"}
                  result={connectionTest.results.vision}
                  onTest={() => connectionTest.onTest("vision")}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
