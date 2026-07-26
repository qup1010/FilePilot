"use client";

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
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
            <h2 className="text-[13px] font-black tracking-tight text-on-surface leading-none">{title}</h2>
            <p className="text-[11px] font-medium text-on-surface-variant/50">{description}</p>
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="px-4 py-4 space-y-5">{children}</div>
    </section>
  );
}

const FIELD_LABEL_CLASS =
  "flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant/50";

/**
 * Provides the FieldGroup-generated control id to descendants (e.g. InputShell)
 * so the nested native form control can be associated with the group label.
 */
const FieldControlIdContext = createContext<string | null>(null);

function isNativeFormControl(element: ReactElement): element is ReactElement<{ id?: string }> {
  return element.type === "input" || element.type === "select" || element.type === "textarea";
}

export function FieldGroup({ label, hint, className, children }: FieldGroupProps) {
  const generatedId = useId();
  const childArray = Children.toArray(children);
  const singleChild = childArray.length === 1 && isValidElement(childArray[0]) ? childArray[0] : null;

  let controlId: string | null = null;
  let content: ReactNode = children;

  if (singleChild && isNativeFormControl(singleChild)) {
    // Direct native control (e.g. a bare <textarea>): attach the id ourselves.
    const existingId = singleChild.props.id;
    controlId = existingId ?? generatedId;
    if (!existingId) {
      content = cloneElement(singleChild, { id: generatedId });
    }
  } else if (childArray.some((child) => isValidElement(child) && child.type === InputShell)) {
    // The control lives inside an InputShell; hand the id down via context.
    controlId = generatedId;
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {controlId ? (
        <label htmlFor={controlId} className={FIELD_LABEL_CLASS}>
          {label}
        </label>
      ) : (
        <span className={FIELD_LABEL_CLASS}>{label}</span>
      )}
      <FieldControlIdContext.Provider value={controlId}>{content}</FieldControlIdContext.Provider>
      {hint ? <p className="px-1 text-[12px] font-medium text-on-surface-variant/40 leading-relaxed">{hint}</p> : null}
    </div>
  );
}

export function InputShell({ icon: Icon, children, className }: InputShellProps) {
  const controlId = useContext(FieldControlIdContext);
  let content: ReactNode = children;
  if (controlId) {
    let injected = false;
    content = Children.map(children, (child) => {
      if (!injected && isValidElement(child) && isNativeFormControl(child) && !child.props.id) {
        injected = true;
        return cloneElement(child, { id: controlId });
      }
      return child;
    });
  }
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
      {content}
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
  ariaLabel,
}: {
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full p-1 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
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
  const listRef = useRef<HTMLDivElement>(null);
  const activePreset = presets.find((preset) => preset.id === activeId) || presets[0] || null;

  const focusOption = (index: number) => {
    const options = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    if (!options || options.length === 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(index, options.length - 1));
    options[clamped].focus();
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (options.length === 0) {
      return;
    }
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusOption(currentIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusOption(currentIndex <= 0 ? 0 : currentIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusOption(0);
        break;
      case "End":
        event.preventDefault();
        focusOption(options.length - 1);
        break;
      default:
        break;
    }
  };

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
              <p className="truncate text-[13px] font-bold tracking-tight text-on-surface">
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
        ref={listRef}
        id={`${label}-preset-list`}
        role="listbox"
        aria-label={label}
        inert={!open}
        aria-hidden={!open}
        onKeyDown={handleListKeyDown}
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
                role="presentation"
                className={cn(
                  "group flex items-center gap-3 rounded-[6px] px-2 py-2 transition-all",
                  active 
                    ? "bg-primary/10 text-primary" 
                    : "hover:bg-on-surface/[0.04] active:scale-[0.98]",
                )}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
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
                    <p className="mt-0.5 text-[11px] font-mono text-on-surface-variant/60">{preset.id}</p>
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
