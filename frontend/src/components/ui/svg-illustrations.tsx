"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface IllustrationProps {
  className?: string;
}

/**
 * 现代简约风格的文件夹雷达扫描插画
 * 适用于等待扫描、空状态或探索准备阶段
 */
export function FileRadarIllustration({ className }: IllustrationProps) {
  return (
    <div className={cn("relative flex items-center justify-center select-none", className)}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="overflow-visible"
      >
        <defs>
          {/* 中心柔光渐变 */}
          <radialGradient id="radarCenterGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--primary, #0078d4)" stopOpacity="0.12" />
            <stop offset="60%" stopColor="var(--primary, #0078d4)" stopOpacity="0.03" />
            <stop offset="100%" stopColor="var(--primary, #0078d4)" stopOpacity="0" />
          </radialGradient>

          {/* 扫掠弧光渐变 */}
          <linearGradient id="sweepArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--primary, #0078d4)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--primary, #0078d4)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 1. 背景柔光晕 */}
        <circle cx="100" cy="100" r="90" fill="url(#radarCenterGlow)" />

        {/* 2. 静态参考同心圆轨 */}
        <circle cx="100" cy="100" r="80" stroke="var(--on-surface, #1a1c1e)" strokeOpacity="0.04" strokeWidth="1" />
        <circle cx="100" cy="100" r="56" stroke="var(--on-surface, #1a1c1e)" strokeOpacity="0.06" strokeWidth="1" strokeDasharray="3 3" />
        <circle cx="100" cy="100" r="34" stroke="var(--primary, #0078d4)" strokeOpacity="0.1" strokeWidth="1" />

        {/* 3. 柔和向外扩散的同心脉冲涟漪 */}
        <motion.circle
          cx="100"
          cy="100"
          r="45"
          stroke="var(--primary, #0078d4)"
          strokeWidth="1.5"
          fill="none"
          initial={{ scale: 0.8, opacity: 0.4 }}
          animate={{ scale: [0.8, 1.75], opacity: [0.45, 0] }}
          transition={{
            repeat: Infinity,
            duration: 3.2,
            ease: "easeOut",
          }}
          style={{ transformOrigin: "100px 100px" }}
        />
        <motion.circle
          cx="100"
          cy="100"
          r="45"
          stroke="var(--primary, #0078d4)"
          strokeWidth="1"
          fill="none"
          initial={{ scale: 0.8, opacity: 0.4 }}
          animate={{ scale: [0.8, 1.75], opacity: [0.45, 0] }}
          transition={{
            repeat: Infinity,
            duration: 3.2,
            delay: 1.6,
            ease: "easeOut",
          }}
          style={{ transformOrigin: "100px 100px" }}
        />

        {/* 4. 平滑旋转的轻量扫描弧 */}
        <motion.path
          d="M 100 24 A 76 76 0 0 1 176 100"
          stroke="url(#sweepArcGrad)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          animate={{ rotate: 360 }}
          transition={{
            repeat: Infinity,
            duration: 4,
            ease: "linear",
          }}
          style={{ transformOrigin: "100px 100px" }}
        />

        {/* 5. 中心轻量文件夹底座与主体 */}
        <g transform="translate(76, 76)">
          {/* 文件夹底板阴影与微光 */}
          <rect
            x="0"
            y="0"
            width="48"
            height="48"
            rx="12"
            fill="var(--surface-container-lowest, #ffffff)"
            stroke="var(--on-surface, #1a1c1e)"
            strokeOpacity="0.08"
            strokeWidth="1"
          />

          {/* 文件夹图标 */}
          <path
            d="M 12 17 L 20 17 L 23 20 L 36 20 C 37.1 20 38 20.9 38 22 L 38 33 C 38 34.1 37.1 35 36 35 L 12 35 C 10.9 35 10 34.1 10 33 L 10 19 C 10 17.9 10.9 17 12 17 Z"
            fill="var(--primary, #0078d4)"
            fillOpacity="0.1"
            stroke="var(--primary, #0078d4)"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />

          {/* 文件夹内部微光点 */}
          <circle cx="24" cy="27.5" r="2" fill="var(--primary, #0078d4)" />
        </g>
      </svg>
    </div>
  );
}

/**
 * 整理成功完成的机械感 SVG 图案
 */
export function FileSuccessIllustration({ className }: IllustrationProps) {
  return (
    <div className={cn("relative flex items-center justify-center select-none", className)}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 240 240"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="overflow-visible"
      >
        <defs>
          <pattern id="successGrid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="var(--md-sys-color-on-surface, #000)"
              strokeOpacity="0.02"
              strokeWidth="1"
            />
          </pattern>
        </defs>

        {/* 1. 网格底板 */}
        <rect x="10" y="10" width="220" height="220" fill="url(#successGrid)" rx="8" />

        {/* 2. 成功背景装饰圆环 */}
        <circle cx="120" cy="120" r="60" stroke="var(--md-sys-color-primary, #0066ff)" strokeOpacity="0.06" strokeWidth="12" />
        <circle cx="120" cy="120" r="80" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.03" strokeWidth="1" strokeDasharray="4 4" />

        {/* 3. 几何机械臂成功对齐指示线 */}
        <path
          d="M 40 120 L 70 120 M 200 120 L 170 120 M 120 40 L 120 70 M 120 200 L 120 170"
          stroke="var(--md-sys-color-on-surface, #000)"
          strokeOpacity="0.1"
          strokeWidth="1.5"
        />

        {/* 4. 文件从零散到归档的几何轨迹动画 */}
        <g opacity="0.3">
          <line x1="80" y1="80" x2="110" y2="110" stroke="var(--md-sys-color-on-surface, #000)" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="160" y1="80" x2="130" y2="110" stroke="var(--md-sys-color-on-surface, #000)" strokeWidth="1" strokeDasharray="3 3" />
        </g>

        {/* 5. 核心勾选与文件夹节点 */}
        <g>
          {/* 大文件夹轮廓 */}
          <path
            d="M 85 95 L 115 95 L 123 105 L 155 105 L 155 145 C 155 147.2 153.2 149 151 149 L 89 149 C 86.8 149 85 147.2 85 145 Z"
            fill="var(--md-sys-color-primary, #0066ff)"
            fillOpacity="0.08"
            stroke="var(--md-sys-color-primary, #0066ff)"
            strokeWidth="2"
            strokeLinejoin="round"
          />

          {/* 成功确认打勾徽章 */}
          <motion.circle
            cx="145"
            cy="140"
            r="16"
            fill="var(--md-sys-color-primary, #0066ff)"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
          />

          <motion.path
            d="M 138 140 L 143 145 L 152 135"
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.3, ease: "easeOut", delay: 0.3 }}
          />
        </g>

        {/* 6. 四角包角装饰 */}
        <path d="M 10 25 L 10 10 L 25 10" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
        <path d="M 230 25 L 230 10 L 215 10" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
        <path d="M 10 215 L 10 230 L 25 230" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
        <path d="M 230 215 L 230 230 L 215 230" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}
