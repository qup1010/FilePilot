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
  tone?: "primary" | "success";
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
  tone = "primary",
}: DropZoneOverlayProps) {
  const isSuccess = tone === "success";
  const gradientId = `dropzone-gradient-${tone}`;

  return (
    <div
      className={cn(
        "absolute inset-2 z-50 flex items-center justify-center rounded-[10px] backdrop-blur-[2px] pointer-events-none animate-in fade-in duration-200 overflow-hidden",
        isSuccess ? "bg-success/[0.035]" : "bg-primary/[0.035]",
        className,
      )}
    >
      {/* 极富科技感的径向微光发光背景 */}
      <div 
        className="absolute inset-0 pointer-events-none animate-pulse" 
        style={{ 
          animationDuration: '4s',
          backgroundImage: isSuccess 
            ? "radial-gradient(circle at center, rgba(16,185,129,0.12) 0%, rgba(5,150,105,0.02) 60%, transparent 90%)"
            : "radial-gradient(circle at center, rgba(59,130,246,0.12) 0%, rgba(139,92,246,0.02) 60%, transparent 90%)"
        }} 
      />

      {/* SVG 流动“电流”虚线渐变边框 */}
      <svg className="absolute inset-0 h-full w-full pointer-events-none" style={{ borderRadius: '10px' }}>
        <rect
          x="1"
          y="1"
          width="calc(100% - 2px)"
          height="calc(100% - 2px)"
          rx="8"
          ry="8"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="2"
          strokeDasharray="6,4"
          style={{
            animation: "dropzone-border-flow 0.8s linear infinite",
          }}
        />
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            {isSuccess ? (
              <>
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.55" />
                <stop offset="50%" stopColor="#059669" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.55" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
                <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.55" />
              </>
            )}
          </linearGradient>
        </defs>
        <style>{`
          @keyframes dropzone-border-flow {
            from { stroke-dashoffset: 0; }
            to { stroke-dashoffset: -20; }
          }
        `}</style>
      </svg>

      <div className={cn("flex flex-col items-center justify-center gap-2 text-center relative z-10", panelClassName)}>
        <div 
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-[12px] shadow-none",
            isSuccess 
              ? "bg-success/12 text-success shadow-[0_0_12px_rgba(16,185,129,0.15)]" 
              : "bg-primary/12 text-primary shadow-[0_0_12px_rgba(59,130,246,0.15)]",
            iconWrapClassName
          )}
        >
          <Icon className="h-6 w-6 stroke-[2.2]" />
        </div>
        <div className="space-y-1">
          <p 
            className={cn(
              "text-[13px] font-black tracking-[0.12em]", 
              isSuccess ? "text-success" : "text-primary",
              titleClassName
            )}
          >
            {title}
          </p>
          {detail ? (
            <p 
              className={cn(
                "text-[11px] font-medium", 
                isSuccess ? "text-success/75" : "text-primary/75",
                detailClassName
              )}
            >
              {detail}
            </p>
          ) : null}
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
