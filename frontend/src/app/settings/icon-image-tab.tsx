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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("common");
  const iconImagePresetEditable = isEditablePreset(activePresetId);

  return (
    <SettingsSection
      icon={ImageIcon}
      title={t("settingsPage.iconImageTab.title")}
      description={t("settingsPage.iconImageTab.description")}
    >
      <SettingsMinPath
        items={[
          t("settingsPage.iconImageTab.guideAnalysis"),
          t("settingsPage.iconImageTab.guideGeneration"),
          t("settingsPage.iconImageTab.guideAdvanced"),
        ]}
      />
      <div className="rounded-xl border border-on-surface/12 bg-surface-container-lowest p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          <p className="text-[12px] font-bold tracking-wide text-primary">{t("settingsPage.iconImageTab.modelRoles")}</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className={cn(
            "rounded-lg border p-3 transition-all",
            textConfigured ? "border-success/25 bg-success/[0.04]" : "border-on-surface/10 bg-surface/50",
          )}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-bold text-on-surface">{t("settingsPage.iconImageTab.textModelAnalysis")}</span>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", textConfigured ? "bg-success/15 text-success-dim" : "bg-on-surface/10 text-on-surface-variant/60")}>
                {textConfigured ? t("settingsPage.iconImageTab.configured") : t("settingsPage.iconImageTab.notConfigured")}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-on-surface-variant/70">{t("settingsPage.iconImageTab.extractThemes")}</p>
            {!textConfigured ? (
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                onClick={onGoToTextTab}
              >
                {t("settingsPage.iconImageTab.goToTextSettings")}
              </button>
            ) : null}
          </div>
          <div className={cn(
            "rounded-lg border p-3 transition-all",
            iconImageConfigured ? "border-success/25 bg-success/[0.04]" : "border-on-surface/10 bg-surface/50",
          )}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-bold text-on-surface">{t("settingsPage.iconImageTab.imageModelPreview")}</span>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", iconImageConfigured ? "bg-success/15 text-success-dim" : "bg-on-surface/10 text-on-surface-variant/60")}>
                {iconImageConfigured ? t("settingsPage.iconImageTab.configured") : t("settingsPage.iconImageTab.notConfigured")}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-on-surface-variant/70">{t("settingsPage.iconImageTab.drawFromKeywords")}</p>
          </div>
        </div>
      </div>
      <PresetSelector
        label={t("settingsPage.iconImageTab.iconPreset")}
        presets={presets}
        activeId={activePresetId}
        onSwitch={onActivatePreset}
        onAdd={onCreatePreset}
        onDelete={(preset) => onDeletePreset(preset.id, preset.name)}
      />
      {!iconImagePresetEditable ? (
        <p className="text-[11px] leading-5 text-ui-muted">
          {t("settingsPage.iconImageTab.firstUse")}
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <ModelIdField
          label={t("settingsPage.iconImageTab.modelId")}
          icon={Terminal}
          value={iconImage.image_model.model}
          placeholder="gpt-image-1"
          onChange={(value) => onUpdate((current) => ({ ...current, image_model: { ...current.image_model, model: value } }))}
          lookupResult={modelLookup.results.icon_image}
          isLoadingModels={modelLookup.loadingFamily === "icon_image"}
          onFetchModels={() => modelLookup.onFetch("icon_image")}
        />
        <FieldGroup label={t("settingsPage.iconImageTab.endpoint")} className="xl:col-span-2" hint={t("settingsPage.iconImageTab.endpointHint")}>
          <InputShell icon={Globe}>
            <input value={iconImage.image_model.base_url} onChange={(event) => onUpdate((current) => ({ ...current, image_model: { ...current.image_model, base_url: event.target.value } }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://host.example/v1" />
          </InputShell>
        </FieldGroup>
        <ProviderCapabilitySummary
          title={t("settingsPage.formFields.currentConnection")}
          kind="icon_image"
          provider={iconImage.image_model.provider}
          apiFormat={iconImage.image_model.api_format}
          toolMode={iconImage.image_model.tool_mode}
          capabilities={iconImage.image_model.capabilities}
        />
        <div className="xl:col-span-2">
          <SecretField label={t("settingsPage.iconImageTab.apiKey")} state={iconImage.image_model.secret_state} secret={iconSecret} setSecret={setIconSecret} family="icon_image" />
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
              <p className="text-[13px] font-bold text-on-surface">{t("settingsPage.iconImageTab.advancedOptions")}</p>
              <p className="mt-0.5 text-[11px] text-ui-muted">{t("settingsPage.iconImageTab.advancedDescription")}</p>
            </div>
            {advancedOpen ? <ChevronDown className="h-4 w-4 text-ui-muted" /> : <ChevronRight className="h-4 w-4 text-ui-muted" />}
          </button>
          {advancedOpen ? (
            <div className="mt-3 grid gap-4 xl:grid-cols-2">
              <FieldGroup label={t("settingsPage.iconImageTab.imageSize")} hint={t("settingsPage.iconImageTab.imageSizeHint")}>
                <div className="grid gap-3 md:grid-cols-3">
                  {IMAGE_SIZE_OPTIONS.map((size) => (
                    <StrategyOptionButton
                      key={size}
                      active={normalizeImageSize(iconImage.image_size) === size}
                      label={size}
                      description={
                        size === "1024x1024"
                          ? t("settingsPage.iconImageTab.sizeDefault")
                          : size === "512x512"
                            ? t("settingsPage.iconImageTab.sizeFast")
                            : t("settingsPage.iconImageTab.sizePreview")
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
              <FieldGroup label={t("settingsPage.iconImageTab.analysisConcurrency")} hint={t("settingsPage.iconImageTab.analysisConcurrencyHint")}>
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
              <FieldGroup label={t("settingsPage.iconImageTab.imageConcurrency")} hint={t("settingsPage.iconImageTab.imageConcurrencyHint")}>
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
              <FieldGroup label={t("settingsPage.iconImageTab.saveMode")} className="xl:col-span-2">
                <div className="grid gap-3 md:grid-cols-2">
                  <StrategyOptionButton active={iconImage.save_mode === "centralized"} label={t("settingsPage.iconImageTab.centralizedSave")} onClick={() => onUpdate((current) => ({ ...current, save_mode: "centralized" }))} description={t("settingsPage.iconImageTab.centralizedSaveDescription")} />
                  <StrategyOptionButton active={iconImage.save_mode === "in_folder"} label={t("settingsPage.iconImageTab.inFolderSave")} onClick={() => onUpdate((current) => ({ ...current, save_mode: "in_folder" }))} description={t("settingsPage.iconImageTab.inFolderSaveDescription")} />
                </div>
              </FieldGroup>
            </div>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
}
