"use client";

import type { ReactNode } from "react";
import { Plus, Trash2, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PresetItem {
  id: string;
  name: string;
}

interface SettingsSectionProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
}

interface FieldGroupProps {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

interface InputShellProps {
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({
  icon: Icon,
  title,
  description,
  actions,
  children,
  disabled = false,
}: SettingsSectionProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[12px] border border-on-surface/8 bg-surface-container-lowest p-5 shadow-[0_18px_44px_rgba(0,0,0,0.04)]",
        disabled && "opacity-55",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-on-surface/6 bg-surface px-4 py-4 -mx-5 -mt-5 mb-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border",
              disabled
                ? "border-on-surface/6 bg-surface-container-low text-on-surface-variant/30"
                : "border-primary/12 bg-primary/10 text-primary",
            )}
          >
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-black tracking-tight text-on-surface">{title}</h2>
            <p className="text-[12px] leading-5 text-on-surface-variant/75">{description}</p>
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function FieldGroup({ label, hint, className, children }: FieldGroupProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <label className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-on-surface-variant/60">
        {label}
      </label>
      {children}
      {hint ? <p className="px-1 text-[12px] leading-5 text-on-surface-variant/55">{hint}</p> : null}
    </div>
  );
}

export function InputShell({ icon: Icon, children, className }: InputShellProps) {
  return (
    <div
      className={cn(
        "ui-field-shell group min-h-[52px] bg-surface-container-lowest px-3 py-2",
        className,
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-surface-container-low text-on-surface-variant/45 transition-colors group-focus-within:text-primary">
        <Icon className="h-4 w-4" />
      </div>
      {children}
    </div>
  );
}

export function StrategyOptionButton({
  active,
  label,
  description,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-[10px] border px-4 py-3 text-left transition-colors",
        active ? "border-primary/20 bg-primary/6 shadow-[0_10px_22px_rgba(0,0,0,0.04)]" : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/16 hover:bg-white",
      )}
    >
      <p className={cn("text-[14px] font-semibold tracking-tight", active ? "text-primary" : "text-on-surface")}>{label}</p>
      <p className="mt-1 text-[13px] leading-6 text-ui-muted">{description}</p>
    </button>
  );
}

export function ToggleSwitch({
  checked,
  onClick,
  disabled = false,
}: {
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full p-1 transition-all disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-surface-container-highest",
      )}
    >
      <span
        className={cn(
          "inline-block h-4.5 w-4.5 rounded-full bg-white transition-transform duration-300",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function PresetManager({
  title,
  presets,
  activeId,
  onSwitch,
  onAdd,
  onDelete,
}: {
  title: string;
  presets: PresetItem[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onDelete: (preset: PresetItem) => void;
}) {
  return (
    <div className="space-y-3 rounded-[10px] border border-on-surface/8 bg-surface px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-on-surface-variant/60">{title}</p>
          <p className="text-[12px] text-on-surface-variant/60">切换后只影响这一类模型的地址、模型和密钥。</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onAdd} className="px-4 py-2">
          <Plus className="mr-1 h-4 w-4" />
          新建
        </Button>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSwitch(preset.id)}
            className={cn(
              "group flex items-center justify-between rounded-[10px] border px-3.5 py-3 text-left transition-colors",
              activeId === preset.id
                ? "border-primary/18 bg-primary/6 shadow-[0_8px_18px_rgba(0,0,0,0.03)]"
                : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/14 hover:bg-white",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold tracking-tight text-on-surface">{preset.name}</p>
              <p className="text-[11px] text-on-surface-variant/45">{preset.id}</p>
            </div>
            {preset.id !== "default" ? (
              <span
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(preset);
                }}
                className="rounded-[8px] p-1.5 text-on-surface-variant/35 transition-colors hover:bg-error/5 hover:text-error"
              >
                <Trash2 className="h-4 w-4" />
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
