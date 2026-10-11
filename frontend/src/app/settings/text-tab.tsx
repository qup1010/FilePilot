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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("common");
  const textPresetEditable = isEditablePreset(textActivePresetId);
  const visionPresetEditable = isEditablePreset(visionActivePresetId);
  const visionUsesSharedText = visionMode === "shared_text";

  return (
    <SettingsSection
      icon={Layers3}
      title={t("settingsPage.textTab.title")}
      description={t("settingsPage.textTab.description")}
    >
      <SettingsMinPath
        items={[
          t("settingsPage.textTab.guideRequired"),
          t("settingsPage.textTab.guideImage"),
          t("settingsPage.textTab.guideTest"),
        ]}
      />
      <PresetSelector
        label={t("settingsPage.textTab.textPreset")}
        presets={textPresets}
        activeId={textActivePresetId}
        onSwitch={(id) => onActivatePreset("text", id)}
        onAdd={() => onCreatePreset("text")}
        onDelete={(preset) => onDeletePreset("text", preset.id, preset.name)}
      />
      {!textPresetEditable ? (
        <p className="text-[11px] leading-5 text-ui-muted">
          {t("settingsPage.textTab.firstUse")}
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <ModelIdField
          label={t("settingsPage.textTab.modelId")}
          icon={Terminal}
          value={textDraft.OPENAI_MODEL}
          placeholder="gpt-5.4"
          onChange={(value) => onUpdateText((current) => ({ ...current, OPENAI_MODEL: value }))}
          lookupResult={modelLookup.results.text}
          isLoadingModels={modelLookup.loadingFamily === "text"}
          onFetchModels={() => modelLookup.onFetch("text")}
        />
        <FieldGroup label={t("settingsPage.textTab.endpoint")} hint={t("settingsPage.textTab.endpointHint")}>
          <InputShell icon={Globe}>
            <input value={textDraft.OPENAI_BASE_URL} onChange={(event) => onUpdateText((current) => ({ ...current, OPENAI_BASE_URL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://api.openai.com/v1" />
          </InputShell>
        </FieldGroup>
        <div className="xl:col-span-2">
          <SecretField label={t("settingsPage.textTab.apiKey")} state={textDraft.secret_state} secret={textSecret} setSecret={setTextSecret} family="text" />
        </div>
        <ProviderCapabilitySummary
          title={t("settingsPage.formFields.currentConnection")}
          kind="text"
          provider={textDraft.provider}
          apiFormat={textDraft.api_format}
          toolMode={textDraft.tool_mode}
          capabilities={textDraft.capabilities}
        />
        <div className="xl:col-span-2">
          <ConnectionTestPanel
            family="text"
            title={t("settingsPage.textTab.textConnectionTest")}
            description={t("settingsPage.formFields.connectionTestDescription")}
            buttonLabel={t("settingsPage.textTab.testTextConnection")}
            isTesting={connectionTest.testingFamily === "text"}
            result={connectionTest.results.text}
            onTest={() => connectionTest.onTest("text")}
          />
        </div>
      </div>
      <div className="rounded-xl border border-on-surface/12 bg-surface/40 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              <h3 className="text-[14px] font-bold text-on-surface">{t("settingsPage.textTab.imageUnderstanding")}</h3>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-on-surface-variant/70">
              {t("settingsPage.textTab.imageUnderstandingDescription")}
            </p>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg border border-on-surface/10 bg-surface-container-lowest px-3 py-1.5 shadow-sm">
            <span className="text-[12px] font-bold text-on-surface/80">{t("settingsPage.textTab.enabled")}</span>
            <ToggleSwitch
              checked={visionEnabled}
              onClick={() => onUpdateGlobal("IMAGE_ANALYSIS_ENABLED", !visionEnabled)}
              ariaLabel={t("settingsPage.textTab.imageUnderstandingAria")}
            />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-[12px] font-bold text-on-surface/80">{t("settingsPage.textTab.currentSource")}</p>
          <div className="mt-2 grid gap-2.5 xl:grid-cols-2">
            {([
              {
                id: "shared_text" as const,
                label: t("settingsPage.textTab.reuseTextModel"),
                description: t("settingsPage.textTab.reuseTextDescription"),
              },
              {
                id: "separate" as const,
                label: t("settingsPage.textTab.separateImageModel"),
                description: t("settingsPage.textTab.separateImageDescription"),
              },
            ] as const).map((item) => {
              const active = visionMode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onUpdateGlobal("IMAGE_ANALYSIS_SOURCE_MODE", item.id)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-all",
                    active
                      ? "border-primary/40 bg-primary/[0.05] shadow-[0_0_0_1px_rgba(0,120,212,0.15)] select-active"
                      : "border-on-surface/10 bg-surface-container-lowest hover:border-primary/25 hover:bg-surface-container-low/50",
                  )}
                >
                  <div className={cn("text-[13px] font-bold", active ? "text-primary" : "text-on-surface")}>{item.label}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-on-surface-variant/70">{item.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        {visionUsesSharedText ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-on-surface/10 bg-surface-container-lowest p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-primary" />
                <p className="text-[13px] font-bold text-on-surface">{t("settingsPage.textTab.currentlyUsingTextModel")}</p>
              </div>
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                <div className="rounded-lg border border-on-surface/8 bg-surface/50 px-3.5 py-2.5">
                  <p className="text-[11px] font-bold text-on-surface-variant/60">{t("settingsPage.textTab.modelId")}</p>
                  <p className="mt-0.5 text-[12px] font-bold text-on-surface">{textDraft.OPENAI_MODEL || t("settingsPage.textTab.notSet")}</p>
                </div>
                <div className="rounded-lg border border-on-surface/8 bg-surface/50 px-3.5 py-2.5">
                  <p className="text-[11px] font-bold text-on-surface-variant/60">{t("settingsPage.textTab.endpoint")}</p>
                  <p className="mt-0.5 break-all font-mono text-[11px] font-medium text-on-surface">{textDraft.OPENAI_BASE_URL || t("settingsPage.textTab.notSet")}</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ui-muted">
                {t("settingsPage.textTab.imageTestDescription")}
              </p>
            </div>
            <ConnectionTestPanel
              family="vision"
              title={t("settingsPage.textTab.imageConnectionTest")}
              description={t("settingsPage.textTab.imageTestDescription")}
              buttonLabel={t("settingsPage.textTab.testImageUnderstanding")}
              isTesting={connectionTest.testingFamily === "vision"}
              result={connectionTest.results.vision}
              onTest={() => connectionTest.onTest("vision")}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <PresetSelector
              label={t("settingsPage.textTab.imagePreset")}
              presets={visionPresets}
              activeId={visionActivePresetId}
              onSwitch={(id) => onActivatePreset("vision", id)}
              onAdd={() => onCreatePreset("vision")}
              onDelete={(preset) => onDeletePreset("vision", preset.id, preset.name)}
            />
            {!visionPresetEditable ? (
              <p className="text-[11px] leading-5 text-ui-muted">
                {t("settingsPage.textTab.imageFirstUse")}
              </p>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-2">
              <ModelIdField
                label={t("settingsPage.textTab.imageModelId")}
                icon={ImageIcon}
                value={visionDraft.IMAGE_ANALYSIS_MODEL}
                placeholder="gpt-4o-mini"
                onChange={(value) => onUpdateVision((current) => ({ ...current, IMAGE_ANALYSIS_MODEL: value }))}
                lookupResult={modelLookup.results.vision}
                isLoadingModels={modelLookup.loadingFamily === "vision"}
                onFetchModels={() => modelLookup.onFetch("vision")}
              />
              <FieldGroup label={t("settingsPage.textTab.imageEndpoint")} hint={t("settingsPage.textTab.imageEndpointHint")}>
                <InputShell icon={Globe}>
                  <input value={visionDraft.IMAGE_ANALYSIS_BASE_URL} onChange={(event) => onUpdateVision((current) => ({ ...current, IMAGE_ANALYSIS_BASE_URL: event.target.value }))} className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none" placeholder="https://host.example/v1" />
                </InputShell>
              </FieldGroup>
              <div className="xl:col-span-2">
                <SecretField label={t("settingsPage.textTab.imageApiKey")} state={visionDraft.secret_state} secret={visionSecret} setSecret={setVisionSecret} family="vision" />
              </div>
              <ProviderCapabilitySummary
                title={t("settingsPage.formFields.currentConnection")}
                kind="vision"
                provider={visionDraft.provider}
                apiFormat={visionDraft.api_format}
                toolMode={visionDraft.tool_mode}
                capabilities={visionDraft.capabilities}
              />
              <div className="xl:col-span-2">
                <ConnectionTestPanel
                  family="vision"
                  title={t("settingsPage.textTab.imageConnectionTest")}
                  description={t("settingsPage.textTab.imageConnectionDescription")}
                  buttonLabel={t("settingsPage.textTab.testImageUnderstanding")}
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
