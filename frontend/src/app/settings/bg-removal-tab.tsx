"use client";

import type { ReactNode } from "react";
import { Cpu, Globe, Scissors, Terminal } from "lucide-react";

import {
  FieldGroup,
  InputShell,
  SettingsSection,
  StrategyOptionButton,
} from "@/components/settings/settings-primitives";
import { SettingsMinPath } from "@/app/settings/preset-form-fields";
import type { DraftState } from "@/app/settings/settings-draft";
import type { BgRemovalBuiltinPreset } from "@/types/settings";
import { useTranslation } from "react-i18next";

export interface BgRemovalTabProps {
  bgRemoval: DraftState["bg_removal"];
  builtinPresets: BgRemovalBuiltinPreset[];
  onUpdate: (updater: (current: DraftState["bg_removal"]) => DraftState["bg_removal"]) => void;
  secretField: ReactNode;
  connectionTestPanel: ReactNode;
}

export function BgRemovalTab({
  bgRemoval,
  builtinPresets,
  onUpdate,
  secretField,
  connectionTestPanel,
}: BgRemovalTabProps) {
  const { t } = useTranslation("common");
  return (
    <SettingsSection
      icon={Scissors}
      title={t("settingsPage.bgRemovalTab.title")}
      description={t("settingsPage.bgRemovalTab.description")}
    >
      <SettingsMinPath
        items={[
          t("settingsPage.bgRemovalTab.guidePurpose"),
          t("settingsPage.bgRemovalTab.guideBuiltIn"),
          t("settingsPage.bgRemovalTab.guideCustom"),
        ]}
      />
      <FieldGroup label={t("settingsPage.bgRemovalTab.serviceMode")}>
        <div className="grid gap-3 md:grid-cols-2">
          <StrategyOptionButton
            active={bgRemoval.mode === "preset"}
            label={t("settingsPage.bgRemovalTab.builtInService")}
            description={t("settingsPage.bgRemovalTab.builtInServiceDescription")}
            onClick={() => onUpdate((current) => ({ ...current, mode: "preset" }))}
          />
          <StrategyOptionButton
            active={bgRemoval.mode === "custom"}
            label={t("settingsPage.bgRemovalTab.customService")}
            description={t("settingsPage.bgRemovalTab.customServiceDescription")}
            onClick={() => onUpdate((current) => ({ ...current, mode: "custom" }))}
          />
        </div>
      </FieldGroup>
      {bgRemoval.mode === "preset" ? (
        <FieldGroup label={t("settingsPage.bgRemovalTab.builtInPreset")}>
          <div className="grid gap-3 xl:grid-cols-2">
            {builtinPresets.map((preset) => (
              <StrategyOptionButton
                key={preset.id}
                active={bgRemoval.preset_id === preset.id}
                label={preset.name}
                description={`${preset.model_id} · ${preset.api_type}`}
                onClick={() => onUpdate((current) => ({ ...current, preset_id: preset.id }))}
              />
            ))}
          </div>
        </FieldGroup>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <FieldGroup label={t("settingsPage.bgRemovalTab.customName")}>
            <InputShell icon={Cpu}>
              <input
                value={bgRemoval.custom.name}
                onChange={(event) =>
                  onUpdate((current) => ({
                    ...current,
                    custom: { ...current.custom, name: event.target.value },
                  }))
                }
                className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                placeholder={t("settingsPage.bgRemovalTab.customNamePlaceholder")}
              />
            </InputShell>
          </FieldGroup>
          <FieldGroup label="Space / Model ID">
            <InputShell icon={Terminal}>
              <input
                value={bgRemoval.custom.model_id}
                onChange={(event) =>
                  onUpdate((current) => ({
                    ...current,
                    custom: { ...current.custom, model_id: event.target.value },
                  }))
                }
                className="w-full bg-transparent py-2 text-sm font-mono font-medium text-on-surface outline-none"
                placeholder="user/space-name"
              />
            </InputShell>
          </FieldGroup>
          <FieldGroup label={t("settingsPage.bgRemovalTab.apiType")}>
            <InputShell icon={Globe}>
              <input
                value={bgRemoval.custom.api_type}
                onChange={(event) =>
                  onUpdate((current) => ({
                    ...current,
                    custom: { ...current.custom, api_type: event.target.value },
                  }))
                }
                className="w-full bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                placeholder="gradio_space"
              />
            </InputShell>
          </FieldGroup>
          <FieldGroup label={t("settingsPage.bgRemovalTab.payloadTemplate")} className="xl:col-span-2" hint={t("settingsPage.bgRemovalTab.payloadTemplateHint")}>
            <textarea
              value={bgRemoval.custom.payload_template}
              onChange={(event) =>
                onUpdate((current) => ({
                  ...current,
                  custom: { ...current.custom, payload_template: event.target.value },
                }))
              }
              className="min-h-32 w-full resize-y rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3 font-mono text-[13px] leading-6 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary focus:ring-4 focus:ring-primary/5"
              placeholder='{"data":[{"path":"{{uploaded_path}}","meta":{"_type":"gradio.FileData"}}],"fn_index":0}'
            />
          </FieldGroup>
        </div>
      )}

      {secretField}
      {connectionTestPanel}
    </SettingsSection>
  );
}
