import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 Tailwind CSS 类名
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const FRIENDLY_STATUS_MAP: Record<string, string> = {
  completed: "已完成",
  success: "已执行完成",
  rolled_back: "已回退",
  scanning: "正在扫描",
  planning: "正在调整方案",
  ready_for_precheck: "可开始预检",
  executing: "正在执行",
  failed: "已中断",
  partially_completed: "部分完成",
  drafting: "正在准备方案",
};

export function getFriendlyStatus(status: string | undefined): string {
  if (!status) return "状态未知";
  return FRIENDLY_STATUS_MAP[status.toLowerCase()] || status;
}

/**
 * 安全转换日期字符串
 */
export function formatDisplayDate(dateStr: string) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return dateStr;
  }
}

export const FRIENDLY_STAGE_MAP: Record<string, string> = {
  idle: "准备中",
  draft: "正在准备方案",
  scanning: "正在扫描",
  planning: "正在调整方案",
  ready_for_precheck: "可开始预检",
  ready_to_execute: "等待执行",
  executing: "正在执行",
  completed: "已完成",
  rolling_back: "正在回退",
  abandoned: "已结束",
  stale: "方案已过期",
  interrupted: "已中断",
};

export function getFriendlyStage(stage: string | undefined): string {
  if (!stage) return "准备中";
  return FRIENDLY_STAGE_MAP[stage.toLowerCase()] || stage;
}
