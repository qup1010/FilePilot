import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface DropZoneOverlayProps {
  icon: LucideIcon;
  title: string;
  detail?: string;
  className?: string;
  panelClassName?: string;
  iconWrapClassName?: string;
  titleClassName?: string;
  detailClassName?: string;
}

export function DropZoneOverlay({
  icon: Icon,
  title,
  detail,
  className,
  panelClassName,
  iconWrapClassName,
  titleClassName,
  detailClassName,
}: DropZoneOverlayProps) {
  return (
    <div
      className={cn(
        "absolute inset-2 z-50 flex items-center justify-center rounded-[10px] border-2 border-dashed border-primary/35 bg-primary/6 backdrop-blur-[2px] pointer-events-none animate-in fade-in duration-200",
        className,
      )}
    >
      <div className={cn("flex flex-col items-center justify-center gap-2 text-center", panelClassName)}>
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-[12px] bg-primary/12 text-primary", iconWrapClassName)}>
          <Icon className="h-6 w-6 stroke-[2.2]" />
        </div>
        <div className="space-y-1">
          <p className={cn("text-[13px] font-black tracking-[0.12em] text-primary", titleClassName)}>{title}</p>
          {detail ? <p className={cn("text-[11px] font-medium text-primary/75", detailClassName)}>{detail}</p> : null}
        </div>
      </div>
    </div>
  );
}

interface DropZoneSurfaceClassNameOptions {
  isActive: boolean;
  isDraggingGlobal?: boolean;
  idleClassName: string;
  className?: string;
  activeClassName?: string;
  draggingClassName?: string;
}

export function getDropZoneSurfaceClassName({
  isActive,
  isDraggingGlobal = false,
  idleClassName,
  className,
  activeClassName,
  draggingClassName,
}: DropZoneSurfaceClassNameOptions) {
  return cn(
    "border border-dashed transition-all duration-300",
    isActive
      ? (activeClassName ?? "border-primary/45 bg-primary/8 text-primary ring-1 ring-primary/15")
      : isDraggingGlobal
        ? (draggingClassName ?? "border-primary/30 bg-primary/[0.025]")
        : idleClassName,
    className,
  );
}
