"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, ArrowRight, Loader2, Play, AlertTriangle, History } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, AnimatePresence } from "motion/react";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl } from "@/lib/runtime";
import { SessionSnapshot } from "@/types/session";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function SessionLauncher() {
  const router = useRouter();
  const [targetDir, setTargetDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumePrompt, setResumePrompt] = useState<{ sessionId: string, snapshot: SessionSnapshot } | null>(null);

  async function handleLaunch(forceNew: boolean = false) {
    if (!targetDir.trim()) return;
    
    setLoading(true);
    setError(null);
    try {
      const api = createApiClient(getApiBaseUrl());
      const response = await api.createSession(targetDir, !forceNew);
      
      if (response.mode === "resume_available" && response.restorable_session?.session_id) {
        setResumePrompt({
          sessionId: response.restorable_session.session_id,
          snapshot: response.restorable_session
        });
        return;
      }
      
      if (!response.session_id) {
        throw new Error("初始化失败：后端未返回有效的访问 ID");
      }
      router.push(`/workspace?session_id=${response.session_id}&dir=${encodeURIComponent(targetDir)}`);
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        setError("系统离线：无法连接到本地服务引擎。请检查后端是否正在运行 (localhost:8000)。");
      } else {
        setError(err instanceof Error ? err.message : "创建会话失败");
      }
    } finally {
      if (!resumePrompt) {
        setLoading(false);
      }
    }
  }

  async function handleSelectDir() {
    setLoading(true);
    setError(null);
    try {
      const api = createApiClient(getApiBaseUrl());
      const res = await api.selectDir();
      if (res.path) {
        setTargetDir(res.path);
      }
    } catch (err) {
      setError("无法调用文件夹选择器，请检查后端运行状态。");
    } finally {
      setLoading(false);
    }
  }

  function handleCancelResume() {
    setResumePrompt(null);
    setLoading(false);
  }

  function handleConfirmResume() {
    if (!resumePrompt) return;
    router.push(`/workspace?session_id=${resumePrompt.sessionId}&dir=${encodeURIComponent(targetDir)}`);
  }

  function handleStartFresh() {
    setResumePrompt(null);
    void handleLaunch(true);
  }

  return (
    <>
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-3xl p-8 shadow-sm relative">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-xl font-bold font-headline text-on-surface">目标目录</h2>
            <p className="text-sm text-on-surface-variant font-medium mt-1">请输入或选择需要整理的绝对路径</p>
          </div>
          <div className={cn(
            "px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase flex items-center gap-1.5 transition-colors",
            loading ? "bg-primary-container text-primary" : "bg-emerald-500/10 text-emerald-600"
          )}>
            {loading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 处理中</>
            ) : (
              <><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> 就绪</>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="relative flex items-center">
            <button 
              type="button"
              onClick={handleSelectDir}
              disabled={loading}
              className="absolute left-4 p-2 text-outline hover:text-primary transition-colors hover:bg-surface-container rounded-lg disabled:opacity-50"
              title="浏览文件夹"
            >
              <FolderOpen className="w-5 h-5" />
            </button>
            
            <input
              value={targetDir}
              onChange={(event) => setTargetDir(event.target.value)}
              disabled={loading}
              className="w-full bg-surface-container-high/40 border-none focus:ring-2 focus:ring-primary/20 rounded-2xl py-4 pl-16 pr-32 text-sm text-on-surface placeholder:text-outline-variant/60 outline-none transition-all disabled:opacity-70"
              placeholder="例如: D:\Downloads"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleLaunch(false);
              }}
            />
            
            <button 
              type="button" 
              onClick={() => void handleLaunch(false)} 
              disabled={loading || !targetDir.trim()}
              className="absolute right-2 px-5 py-2.5 bg-primary text-white font-bold text-sm rounded-xl shadow-sm hover:opacity-90 hover:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center gap-2"
            >
              {loading ? "启动中" : "开始整理"}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }} 
                animate={{ opacity: 1, height: "auto" }} 
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-error-container/20 text-error px-4 py-3 rounded-xl text-sm font-medium border border-error/10 flex items-start gap-3 mt-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Resume Prompt Modal */}
      <AnimatePresence>
        {resumePrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/80 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-surface-container-lowest border border-outline-variant/20 shadow-2xl rounded-2xl p-8 max-w-lg w-full"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-6">
                <History className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold font-headline text-on-surface mb-2">发现进行中的整理工作</h2>
              <p className="text-sm text-on-surface-variant mb-8 leading-relaxed">
                引擎检测到该目录 (<strong>{targetDir.split(/[\\/]/).pop()}</strong>) 之前有未完成的整理进度（所在阶段：<em>{resumePrompt.snapshot.stage}</em>）。是否恢复上次的对话和预览状态继续工作？
              </p>
              
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleConfirmResume}
                  className="w-full py-3 bg-primary text-white rounded-xl font-bold hover:opacity-90 transition-opacity active:scale-[0.98]"
                >
                  继续上次整理
                </button>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={handleStartFresh}
                    className="w-full py-3 bg-surface-container text-on-surface rounded-xl font-bold hover:bg-surface-container-high transition-colors active:scale-[0.98]"
                  >
                    重新开始
                  </button>
                  <button 
                    onClick={handleCancelResume}
                    className="w-full py-3 border border-outline-variant/30 text-on-surface-variant rounded-xl font-bold hover:bg-surface-container-low transition-colors active:scale-[0.98]"
                  >
                    取消
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
