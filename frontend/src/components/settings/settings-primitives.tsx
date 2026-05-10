"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Plus, Trash2, type LucideIcon } from "lucide-react";

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
        "overflow-hidden rounded-xl border border-on-surface/8 bg-surface-container-lowest",
        disabled && "opacity-55",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-on-surface/6 bg-surface px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon className={cn("h-4 w-4 shrink-0", disabled ? "text-on-surface-variant/30" : "text-primary/70")} />
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-[13.5px] font-black tracking-tight text-on-surface leading-none">{title}</h2>
            <p className="text-[11px] font-medium text-on-surface-variant/50">{description}</p>
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="px-4 py-4 space-y-5">{children}</div>
    </section>
  );
}

export function FieldGroup({ label, hint, className, children }: FieldGroupProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant/50">
        {label}
      </label>
      {children}
      {hint ? <p className="px-1 text-[11.5px] font-medium text-on-surface-variant/40 leading-relaxed">{hint}</p> : null}
    </div>
  );
}

export function InputShell({ icon: Icon, children, className }: InputShellProps) {
  return (
    <div
      className={cn(
        "ui-field-shell group min-h-[36px] bg-surface-container-lowest border border-on-surface/10 rounded-[6px] px-2 transition-colors focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/10",
        className,
      )}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center text-on-surface-variant/30 transition-colors group-focus-within:text-primary">
        <Icon className="h-3 w-3" />
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
        "w-full rounded-[6px] border px-3 py-2 text-left transition-colors",
        active 
          ? "border-primary/40 bg-primary/[0.04] select-active" 
          : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/20 hover:bg-surface-container-low",
      )}
    >
      <p className={cn("text-[12px] font-black tracking-tight", active ? "text-primary" : "text-on-surface")}>{label}</p>
      <p className="mt-0.5 text-[11px] font-medium leading-relaxed text-ui-muted/70">{description}</p>
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
      role="switch"
      aria-checked={checked}
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
                ? "border-primary/25 bg-primary/10"
                : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/18 hover:bg-surface-container-low",
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

export function PresetSelector({
  label,
  presets,
  activeId,
  onSwitch,
  onAdd,
  onDelete,
  disabled = false,
}: {
  label: string;
  presets: PresetItem[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onDelete: (preset: PresetItem) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activePreset = presets.find((preset) => preset.id === activeId) || presets[0] || null;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [activeId]);

  return (
    <div ref={containerRef} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <label className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-on-surface-variant/60">
            {label}
          </label>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={`${label}-preset-list`}
            className={cn(
              "flex min-h-[46px] w-full items-center justify-between gap-4 rounded-[6px] border px-3 py-2 text-left transition-[border-color,background-color] duration-150",
              open
                ? "border-primary/25 bg-primary/10"
                : "border-on-surface/10 bg-surface-container-lowest hover:border-primary/20 hover:bg-surface-container-low",
              disabled && "cursor-not-allowed opacity-55",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-bold tracking-tight text-on-surface">
                {activePreset?.name || "选择预设..."}
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-on-surface-variant/60">
                {activePreset ? "切换后会应用此预设的连接信息。" : "当前还没有可用预设。"}
              </p>
            </div>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-on-surface-variant/55 transition-transform", open && "rotate-180")} />
          </button>
        </div>

        <Button
          variant="secondary"
          onClick={onAdd}
          disabled={disabled}
          className="min-h-[46px] shrink-0 rounded-[6px] px-5 font-bold"
          aria-label={`新建${label}`}
        >
          <Plus className="h-4 w-4 mr-1" />
          新建预设
        </Button>
      </div>

      <div
        id={`${label}-preset-list`}
        role="listbox"
        className={cn(
          "overflow-hidden rounded-[8px] border border-on-surface/8 bg-surface transition-[max-height,opacity,margin] duration-200",
          open ? "max-h-[320px] opacity-100 mt-1" : "max-h-0 border-transparent opacity-0 mt-0",
        )}
      >
        <div className="max-h-[320px] overflow-y-auto p-1.5 scrollbar-thin">
          {presets.map((preset) => {
            const active = preset.id === activeId;
            return (
              <div
                key={preset.id}
                className={cn(
                  "group flex items-center gap-3 rounded-[6px] px-2 py-2 transition-all",
                  active 
                    ? "bg-primary/10 text-primary" 
                    : "hover:bg-on-surface/[0.04] active:scale-[0.98]",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSwitch(preset.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span
                    className={cn(
                      "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-sm transition-colors",
                      active ? "bg-primary text-white" : "border border-on-surface/14 bg-surface-container-lowest text-transparent",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <div className="min-w-0">
                    <p className={cn("truncate text-[13px] font-bold tracking-tight", active ? "text-primary" : "text-on-surface")}>{preset.name}</p>
                    <p className="mt-0.5 text-[10.5px] font-mono text-on-surface-variant/60">{preset.id}</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(preset)}
                  className="rounded-[6px] p-1.5 text-on-surface-variant/40 transition-colors hover:bg-error/10 hover:text-error"
                  aria-label={`删除预设 ${preset.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
