"use client";

import type { Dispatch, SetStateAction } from "react";
import { ChevronDown, ChevronRight, Cpu, Globe, ImageIcon, Terminal } from "lucide-react";

import {
  FieldGroup,
  InputShell,
  PresetSelector,
  SettingsSection,
  StrategyOptionButton,
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
import {
  IMAGE_SIZE_OPTIONS,
  normalizeImageSize,
  type DraftState,
  type SecretDraft,
} from "@/app/settings/settings-draft";
import { cn } from "@/lib/utils";

export interface IconImageTabProps {
  iconImage: DraftState["icon_image"];
  presets: PresetItem[];
  activePresetId: string;
  textConfigured: boolean;
  iconImageConfigured: boolean;
  analysisConcurrencyInput: string;
  imageConcurrencyInput: string;
  onChangeAnalysisConcurrencyInput: (value: string) => void;
  onChangeImageConcurrencyInput: (value: string) => void;
  onCommitAnalysisConcurrencyInput: () => void;
  onCommitImageConcurrencyInput: () => void;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  iconSecret: SecretDraft;
  setIconSecret: Dispatch<SetStateAction<SecretDraft>>;
  onUpdate: (updater: (current: DraftState["icon_image"]) => DraftState["icon_image"]) => void;
  onActivatePreset: (presetId: string) => void;
  onCreatePreset: () => void;
  onDeletePreset: (presetId: string, presetName: string) => void;
  onGoToTextTab: () => void;
  connectionTest: ConnectionTestControls;
  modelLookup: ModelLookupControls;
}

export function IconImageTab({
  iconImage,
  presets,
  activePresetId,
  textConfigured,
  iconImageConfigured,
  analysisConcurrencyInput,
  imageConcurrencyInput,
  onChangeAnalysisConcurrencyInput,
  onChangeImageConcurrencyInput,
  onCommitAnalysisConcurrencyInput,
  onCommitImageConcurrencyInput,
  advancedOpen,
  onToggleAdvanced,
  iconSecret,
  setIconSecret,
  onUpdate,
  onActivatePreset,
  onCreatePreset,
  onDeletePreset,
  onGoToTextTab,
  connectionTest,
  modelLookup,
}: IconImageTabProps) {
  const iconImagePresetEditable = isEditablePreset(activePresetId);

  return (
    <SettingsSection
      icon={ImageIcon}
      title="图标生图配置"
      description="配置图标工坊的 AI 图像生成模型；目录分析使用整理文本模型。"
    >
      <SettingsMinPath
        items={[
          "目录分析：提炼文件夹主题与关键词，依赖「整理模型配置」中的文本模型",
          "图标生图：本页配置绘制图标预览图的生图模型（接口地址 + 模型 ID + API 密钥）",
          "高级选项：可按需调整图标尺寸、并发数上限及本地保存位置",
        ]}
      />
      <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/55">双模型依赖</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className={cn(
            "rounded-[8px] border px-3 py-2",
            textConfigured ? "border-success/20 bg-success/5" : "border-on-surface/8 bg-surface",
          )}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold text-on-surface">文本模型（分析）</span>
              <span className={cn("text-[11px] font-black", textConfigured ? "text-success-dim" : "text-on-surface/40")}>
                {textConfigured ? "已配置" : "未配置"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-ui-muted">用于提炼文件夹主题与关键词</p>
            {!textConfigured ? (
              <button
                type="button"
                className="mt-2 text-[11px] font-bold text-primary hover:underline"
                onClick={onGoToTextTab}
              >
                去配置整理模型
              </button>
            ) : null}
          </div>
          <div className={cn(
            "rounded-[8px] border px-3 py-2",
            iconImageConfigured ? "border-success/20 bg-success/5" : "border-on-surface/8 bg-surface",
          )}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold text-on-surface">生图模型（预览）</span>
              <span className={cn("text-[11px] font-black", iconImageConfigured ? "text-success-dim" : "text-on-surface/40")}>
                {iconImageConfigured ? "已配置" : "未配置"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-ui-muted">根据关键词绘制图标预览图</p>
          </div>
        </div>
      </div>
      <PresetSelector
        label="图标生图预设"
        presets={presets}
        activeId={activePresetId}
        onSwitch={onActivatePreset}
        onAdd={onCreatePreset}
        onDelete={(preset) => onDeletePreset(preset.id, preset.name)}
      />
      {!iconImagePresetEditable ? (
        <p className="text-[11px] leading-5 text-ui-muted">
          首次使用请直接在下方填写配置，首次保存时会自动创建可编辑预设。
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <ModelIdField
          label="生图模型 ID"
          icon={Terminal}
          value={iconImage.image_model.model}
          placeholder="gpt-image-1"
          onChange={(value) => onUpdate((current) => ({ ...current, image_model: { ...current.image_model, model: value } }))}
          lookupResult={modelLookup.results.icon_image}
          isLoadingModels={modelLookup.loadingFamily === "icon_image"}
          onFetchModels={() => modelLookup.onFetch("icon_image")}
        />
        <FieldGroup label="生图接口地址" className="xl:col-span-2" hint="可填写 OpenAI 兼容 /v1 地址，或服务商给出的完整 /images/generations 端点。">
          <InputShell icon={Globe}>
            <input value={iconImage.image_model.base_url} onChange={(event) => onUpdate((current) => ({ ...current, image_model: { ...current.image_model, base_url: event.target.value } }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://host.example/v1" />
          </InputShell>
        </FieldGroup>
        <ProviderCapabilitySummary
          title="当前连接方式"
          kind="icon_image"
          provider={iconImage.image_model.provider}
          apiFormat={iconImage.image_model.api_format}
          toolMode={iconImage.image_model.tool_mode}
          capabilities={iconImage.image_model.capabilities}
        />
        <div className="xl:col-span-2">
          <SecretField label="生图接口密钥" state={iconImage.image_model.secret_state} secret={iconSecret} setSecret={setIconSecret} family="icon_image" />
        </div>
        <div className="xl:col-span-2">
          <ConnectionTestPanel
            family="icon_image"
            isTesting={connectionTest.testingFamily === "icon_image"}
            result={connectionTest.results.icon_image}
            onTest={() => connectionTest.onTest("icon_image")}
          />
        </div>
        <div className="xl:col-span-2">
          <button
            type="button"
            onClick={onToggleAdvanced}
            className="flex w-full items-center justify-between rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3 text-left transition-colors hover:border-primary/20"
          >
            <div>
              <p className="text-[13px] font-bold text-on-surface">高级选项</p>
              <p className="mt-0.5 text-[11px] text-ui-muted">图片尺寸、分析/生图并发数、保存方式</p>
            </div>
            {advancedOpen ? <ChevronDown className="h-4 w-4 text-ui-muted" /> : <ChevronRight className="h-4 w-4 text-ui-muted" />}
          </button>
          {advancedOpen ? (
            <div className="mt-3 grid gap-4 xl:grid-cols-2">
              <FieldGroup label="图片尺寸" hint="默认 1024x1024，适合文件夹图标；更小尺寸生成更快。">
                <div className="grid gap-3 md:grid-cols-3">
                  {IMAGE_SIZE_OPTIONS.map((size) => (
                    <StrategyOptionButton
                      key={size}
                      active={normalizeImageSize(iconImage.image_size) === size}
                      label={size}
                      description={
                        size === "1024x1024"
                          ? "默认，细节更清晰。"
                          : size === "512x512"
                            ? "更快，够用多数场景。"
                            : "预览用，细节较少。"
                      }
                      onClick={() =>
                        onUpdate((current) => ({
                          ...current,
                          image_size: size,
                        }))
                      }
                    />
                  ))}
                </div>
              </FieldGroup>
              <FieldGroup label="分析并发数" hint="同时分析多少个文件夹的内容（通常可以设得比生图更高，建议 2～4）。">
                <InputShell icon={Cpu}>
                  <input
                    value={analysisConcurrencyInput}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      if (/^\d*$/.test(nextValue)) {
                        onChangeAnalysisConcurrencyInput(nextValue);
                      }
                    }}
                    onBlur={onCommitAnalysisConcurrencyInput}
                    className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                    placeholder="2"
                    inputMode="numeric"
                  />
                </InputShell>
              </FieldGroup>
              <FieldGroup label="生图并发数" hint="同时生成多少张图标图像（生图接口限流较严，建议保持为 1）。">
                <InputShell icon={Cpu}>
                  <input
                    value={imageConcurrencyInput}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      if (/^\d*$/.test(nextValue)) {
                        onChangeImageConcurrencyInput(nextValue);
                      }
                    }}
                    onBlur={onCommitImageConcurrencyInput}
                    className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                    placeholder="1"
                    inputMode="numeric"
                  />
                </InputShell>
              </FieldGroup>
              <FieldGroup label="保存方式" className="xl:col-span-2">
                <div className="grid gap-3 md:grid-cols-2">
                  <StrategyOptionButton active={iconImage.save_mode === "centralized"} label="应用内统一管理（推荐）" onClick={() => onUpdate((current) => ({ ...current, save_mode: "centralized" }))} description="生成的图标集中保存在应用数据目录中，不污染原文件夹。" />
                  <StrategyOptionButton active={iconImage.save_mode === "in_folder"} label="保存在原文件夹内" onClick={() => onUpdate((current) => ({ ...current, save_mode: "in_folder" }))} description="图标文件直接保存在对应的目标文件夹中，便于直接查看和备份。" />
                </div>
              </FieldGroup>
            </div>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
}
