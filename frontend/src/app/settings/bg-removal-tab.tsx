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
  return (
    <SettingsSection
      icon={Scissors}
      title="背景处理"
      description="配置背景裁剪及抠图服务的端点和模型参数。"
    >
      <SettingsMinPath
        items={[
          "与 OpenAI 兼容聊天/生图接口无关，走 Hugging Face Space 类服务",
          "默认选内置预设即可；需要私有 Space 时再切自定义",
          "HF Token 可选，公开 Space 通常不填也能用",
        ]}
      />
      <FieldGroup label="服务模式">
        <div className="grid gap-3 md:grid-cols-2">
          <StrategyOptionButton
            active={bgRemoval.mode === "preset"}
            label="使用内置预设"
            description="直接使用内置的背景处理服务，适合快速开始。"
            onClick={() => onUpdate((current) => ({ ...current, mode: "preset" }))}
          />
          <StrategyOptionButton
            active={bgRemoval.mode === "custom"}
            label="自定义服务"
            description="手动填写 Space ID、API 类型和 payload_template。"
            onClick={() => onUpdate((current) => ({ ...current, mode: "custom" }))}
          />
        </div>
      </FieldGroup>
      {bgRemoval.mode === "preset" ? (
        <FieldGroup label="内置预设">
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
          <FieldGroup label="自定义名称">
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
                placeholder="自定义抠图"
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
          <FieldGroup label="API 类型">
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
          <FieldGroup label="Payload Template" className="xl:col-span-2" hint="填写原始 JSON 文本，可使用 {{uploaded_path}} 与 {{model_id}} 占位符。">
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
