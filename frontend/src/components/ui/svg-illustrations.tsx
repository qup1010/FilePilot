"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface IllustrationProps {
  className?: string;
}

/**
 * 具有三维雷达扫掠和数据连接节点的机械工程风格 SVG 雷达扫描插画
 * 适用于空状态、等待扫描或无内容面板
 */
export function FileRadarIllustration({ className }: IllustrationProps) {
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
          {/* 雷达扫描渐变 */}
          <radialGradient id="radarSweepGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--md-sys-color-primary, #0066ff)" stopOpacity="0.15" />
            <stop offset="70%" stopColor="var(--md-sys-color-primary, #0066ff)" stopOpacity="0.04" />
            <stop offset="100%" stopColor="var(--md-sys-color-primary, #0066ff)" stopOpacity="0" />
          </radialGradient>

          {/* 网格图案 */}
          <pattern id="radarGrid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="var(--md-sys-color-on-surface, #000)"
              strokeOpacity="0.03"
              strokeWidth="1"
            />
          </pattern>

          {/* 节点外层呼吸环发光滤镜 */}
          <filter id="nodeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* 1. 网格底板 */}
        <rect x="10" y="10" width="220" height="220" fill="url(#radarGrid)" rx="8" />
        
        {/* 2. 背景十字准星与辅助刻度 */}
        <line x1="120" y1="10" x2="120" y2="230" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.06" strokeWidth="1" strokeDasharray="4 4" />
        <line x1="10" y1="120" x2="230" y2="120" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.06" strokeWidth="1" strokeDasharray="4 4" />

        {/* 3. 同心圆测量轨 */}
        <circle cx="120" cy="120" r="100" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.04" strokeWidth="1.5" />
        <circle cx="120" cy="120" r="70" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.06" strokeWidth="1" strokeDasharray="3 3" />
        <circle cx="120" cy="120" r="40" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.08" strokeWidth="1" />
        <circle cx="120" cy="120" r="10" stroke="var(--md-sys-color-primary, #0066ff)" strokeOpacity="0.2" strokeWidth="1" />

        {/* 4. 雷达动态扫描扇区 */}
        <motion.circle
          cx="120"
          cy="120"
          r="100"
          fill="url(#radarSweepGrad)"
          style={{ originX: "120px", originY: "120px" }}
          animate={{ rotate: 360 }}
          transition={{
            repeat: Infinity,
            duration: 6,
            ease: "linear",
          }}
        />

        {/* 5. 动态扫掠的刻度指针 */}
        <motion.line
          x1="120"
          y1="120"
          x2="120"
          y2="20"
          stroke="var(--md-sys-color-primary, #0066ff)"
          strokeOpacity="0.4"
          strokeWidth="1.5"
          style={{ originX: "120px", originY: "120px" }}
          animate={{ rotate: 360 }}
          transition={{
            repeat: Infinity,
            duration: 6,
            ease: "linear",
          }}
        />

        {/* 6. 数据分支连接线 (机械分支感) */}
        <path
          d="M 120 120 L 70 80 L 40 80 M 120 120 L 170 160 L 190 160 M 120 120 L 160 70 M 120 120 L 80 170"
          stroke="var(--md-sys-color-on-surface, #000)"
          strokeOpacity="0.08"
          strokeWidth="1"
        />

        {/* 7. 雷达中检测到的数据节点 (带点按脉冲和发光效果) */}
        
        {/* 节点 A: 绿蓝色成功数据点 */}
        <g>
          <motion.circle
            cx="70"
            cy="80"
            r="12"
            fill="var(--md-sys-color-primary, #0066ff)"
            fillOpacity="0.08"
            animate={{ scale: [1, 1.4, 1] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          />
          <circle cx="70" cy="80" r="4" fill="var(--md-sys-color-primary, #0066ff)" filter="url(#nodeGlow)" />
        </g>

        {/* 节点 B: 橙黄色待确认数据点 */}
        <g>
          <motion.circle
            cx="170"
            cy="160"
            r="16"
            fill="var(--md-sys-color-secondary, #ff9900)"
            fillOpacity="0.06"
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut", delay: 0.5 }}
          />
          <circle cx="170" cy="160" r="3" fill="var(--md-sys-color-secondary, #ff9900)" />
        </g>

        {/* 节点 C: 边缘小检测点 */}
        <g>
          <circle cx="40" cy="80" r="2.5" fill="var(--md-sys-color-on-surface, #000)" fillOpacity="0.3" />
        </g>

        {/* 节点 D: 边缘小检测点 */}
        <g>
          <circle cx="190" cy="160" r="2.5" fill="var(--md-sys-color-on-surface, #000)" fillOpacity="0.3" />
        </g>

        {/* 8. 四角机械包角装饰 (体现 Workbench 工业质感) */}
        <path d="M 10 25 L 10 10 L 25 10" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
        <path d="M 230 25 L 230 10 L 215 10" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
        <path d="M 10 215 L 10 230 L 25 230" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
        <path d="M 230 215 L 230 230 L 215 230" stroke="var(--md-sys-color-on-surface, #000)" strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
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
