"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { cn } from "@/lib/utils";
import type { SessionSnapshot } from "@/types/session";
import { getWorkspaceRouteForSnapshot } from "@/lib/workspace-routes";
import {
  clearActiveWorkspaceRoute,
  getSessionIdFromWorkspaceRoute,
  readActiveWorkspaceRoute,
  subscribeAppContext,
} from "@/lib/app-context-store";

export function GlobalTaskIndicator() {
  const pathname = usePathname();
  const router = useRouter();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeRoute, setActiveRoute] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // 从本地记录中同步当前任务入口。
  useEffect(() => {
    const checkActive = () => {
      const route = readActiveWorkspaceRoute();
      const sid = getSessionIdFromWorkspaceRoute(route);
      setActiveRoute(route);
      setActiveSessionId(sid);
    };

    checkActive();
    // storage 只会响应其他标签页，subscribeAppContext 会同时监听应用内上下文刷新事件。
    return subscribeAppContext(checkActive);
  }, []);

  // 有当前任务时，定时读取后端快照。
  // 工作区页面本身已通过 SSE 持有完整快照，此时轮询只是重复开销，直接停掉。
  useEffect(() => {
    if (!activeSessionId || pathname.startsWith("/workspace")) {
      setSnapshot(null);
      setIsVisible(false);
      return;
    }

    let timer: number;
    const api = createApiClient(getApiBaseUrl(), getApiToken());

    const update = async () => {
      try {
        const res = await api.getSession(activeSessionId);
        setSnapshot(res.session_snapshot);
      } catch (err) {
        const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : null;
        if (status === 404) {
          clearActiveWorkspaceRoute();
          setActiveRoute(null);
          setActiveSessionId(null);
          setSnapshot(null);
          setIsVisible(false);
          return;
        }
        setSnapshot(null);
      }
    };

    update();
    timer = window.setInterval(update, 3000);

    return () => window.clearInterval(timer);
  }, [activeSessionId, pathname]);

  const taskState = useMemo(() => {
    if (!snapshot) return null;
    
    const s = snapshot;
    const stage = s.stage;
    
    if (stage === "scanning") {
      const p = s.scanner_progress;
      const percent = p.total_count ? Math.round((p.processed_count || 0) / p.total_count * 100) : 0;
      return {
        label: p.processed_count ? `正在分析内容（${p.processed_count}/${p.total_count}）` : "正在读取目录",
        percent,
        status: "active" as const
      };
    }
    
    if (s.planner_progress?.status === "running") {
      return {
        label: s.planner_progress.message || "正在生成方案",
        percent: 0,
        status: "active" as const,
        indeterminate: true
      };
    }

    if (stage === "executing") {
      return {
        label: "正在执行整理",
        percent: 0,
        status: "active" as const,
        indeterminate: true
      };
    }

    if (stage === "rolling_back") {
      return {
        label: "正在执行回退",
        percent: 0,
        status: "active" as const,
        indeterminate: true
      };
    }

    return null;
  }, [snapshot]);

  // 只在当前任务页之外显示，避免和工作区主提示重复。
  useEffect(() => {
    if (pathname.startsWith("/workspace")) {
      setIsVisible(false);
    } else {
      setIsVisible(!!taskState);
    }
  }, [pathname, taskState]);

  return (
    <AnimatePresence>
      {isVisible && taskState && (
        <motion.div
          initial={{ y: 20, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.95 }}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-4 rounded-full border border-primary/40 bg-surface/90 px-4 py-2.5 backdrop-blur-xl ring-1 ring-white/10"
        >
          <div className="flex items-center gap-3 min-w-0">
             <div className="flex h-5 w-5 items-center justify-center">
                <Loader2 className={cn("h-3.5 w-3.5 animate-spin text-primary", !taskState.indeterminate && "hidden")} />
                {!taskState.indeterminate && (
                  <div className="relative h-4 w-4 rounded-full border-2 border-primary/10">
                     <svg className="absolute -left-[2px] -top-[2px] h-[18px] w-[18px] -rotate-90">
                        <circle
                          cx="9"
                          cy="9"
                          r="7.5"
                          fill="transparent"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeDasharray={47}
                          strokeDashoffset={47 - (47 * taskState.percent) / 100}
                          className="text-primary transition-all duration-500"
                        />
                     </svg>
                  </div>
                )}
             </div>
             <div className="flex flex-col min-w-0 pr-1">
               <span className="truncate text-[12px] font-black tracking-tight text-on-surface leading-none">
                 {taskState.label}
               </span>
               <span className="mt-1 text-[11px] font-bold uppercase tracking-widest text-primary/60 leading-none">
                 后台任务
               </span>
             </div>
          </div>
          
           <div className="flex items-center gap-3 border-l border-on-surface/8 pl-3">
              <button 
                onClick={() => router.push(snapshot ? getWorkspaceRouteForSnapshot(snapshot) : activeRoute || `/workspace/progress?session_id=${activeSessionId}`)}
                className="group flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary transition-all hover:bg-primary hover:text-white"
                title="查看任务详情"
              >
               <Loader2 className="h-3.5 w-3.5" />
             </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
