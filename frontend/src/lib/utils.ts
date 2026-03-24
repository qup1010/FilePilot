import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 Tailwind CSS 类名
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 将后端原始状态值映射为用户友好的中文描述
 */
export function getFriendlyStatus(status: string | undefined): string {
  if (!status) return "未知状态";
  
  const mapping: Record<string, string> = {
    "completed": "已完成",
    "success": "执行成功",
    "rolled_back": "已回退",
    "scanning": "正在深度扫描",
    "planning": "分析并生成方案",
    "ready_for_precheck": "等待确认执行",
    "executing": "正在执行重组",
    "failed": "扫描或执行中断",
    "partially_completed": "部分完成 (需介入)",
    "drafting": "草案构思中"
  };

  return mapping[status.toLowerCase()] || status;
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

/**
 * 将端侧 stage 映射为中文友好文字
 */
export function getFriendlyStage(stage: string | undefined): string {
  if (!stage) return "空闲";
  
  const mapping: Record<string, string> = {
    "idle": "准备中",
    "draft": "草案构思",
    "scanning": "深度扫描中",
    "planning": "方案调整中",
    "ready_for_precheck": "等待确认预检",
    "ready_to_execute": "等待执行",
    "executing": "正在执行",
    "completed": "整理已完成",
    "rolling_back": "正在回退",
    "abandoned": "已放弃",
    "stale": "会话已失效",
    "interrupted": "发生中断"
  };

  return mapping[stage.toLowerCase()] || stage;
}
