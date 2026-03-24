"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Server, Globe, Cpu, ArrowLeft, Terminal, ShieldCheck,
  Settings as SettingsIcon, Info, Save, RefreshCw, CheckCircle2, AlertCircle, Eye, EyeOff,
  Plus, Trash2, ChevronDown, Copy, Edit3
} from "lucide-react";
import Link from "next/link";
import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { ErrorAlert } from "@/components/ui/error-alert";
import { motion, AnimatePresence } from "framer-motion";
import { cn, getFriendlyStatus } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [config, setConfig] = useState<any>(null);
  const [originalConfig, setOriginalConfig] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testVision, setTestVision] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{type: 'text' | 'vision', status: 'success' | 'error', message: string} | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showVisionKey, setShowVisionKey] = useState(false);

  // Dialog states
  const [dialog, setDialog] = useState<{
    type: 'prompt' | 'confirm';
    title: string;
    message: string;
    value?: string;
    onConfirm: (val?: string) => void;
  } | null>(null);

  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);

  const isDirty = useMemo(() => {
    if (!config || !originalConfig) return false;
    return JSON.stringify(config) !== JSON.stringify(originalConfig);
  }, [config, originalConfig]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const data = await api.getConfig();
      setProfiles(data.profiles);
      setActiveId(data.active_id);
      setConfig(data.config);
      setOriginalConfig(data.config);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handleChange = (key: string, value: any) => {
    setConfig((prev: any) => ({ ...prev, [key]: value }));
    setSuccess(null);
    setTestResult(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateConfig(config);
      setSuccess("当前方案设置已保存到核心引擎。");
      setOriginalConfig(config);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchProfile = async (id: string) => {
    if (id === activeId) return;
    if (isDirty) {
      setDialog({
        type: 'confirm',
        title: '放弃更改？',
        message: '当前方案有未保存的修改，切换方案将丢失这些更改。',
        onConfirm: () => performSwitch(id)
      });
      return;
    }
    performSwitch(id);
  };

  const performSwitch = async (id: string) => {
    setDialog(null);
    setLoading(true);
    try {
      await api.switchProfile(id);
      await fetchAll();
      setSuccess("已成功切换配置方案。");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleAddProfile = async () => {
    setDialog({
      type: 'prompt',
      title: '新建配置方案',
      message: '请为这个新方案起一个好记的名字。',
      value: '我的新方案',
      onConfirm: async (name) => {
        if (!name) return;
        setDialog(null);
        setLoading(true);
        try {
          await api.addProfile(name, true);
          await fetchAll();
        } catch (err: any) {
          setError(err.message);
          setLoading(false);
        }
      }
    });
  };

  const handleDeleteProfile = async (id: string, name: string) => {
    if (id === "default") {
      setDialog({
        type: 'confirm',
        title: '无法删除',
        message: '默认方案是系统运行的基础，受保护不可删除。',
        onConfirm: () => setDialog(null)
      });
      return;
    }
    setDialog({
      type: 'confirm',
      title: '确认删除方案？',
      message: `你确定要永久删除方案 "${name}" 吗？此操作无法撤销。`,
      onConfirm: async () => {
        setDialog(null);
        setLoading(true);
        try {
          await api.deleteProfile(id);
          await fetchAll();
        } catch (err: any) {
          setError(err.message);
          setLoading(false);
        }
      }
    });
  };

  const handleTest = async (type: 'text' | 'vision') => {
    if (type === 'text') setTesting(true); else setTestVision(true);
    setTestResult(null);
    try {
      const data = await api.testLlm({ ...config, test_type: type });
      setTestResult({
        type,
        status: data.status === 'ok' ? 'success' : 'error',
        message: data.message
      });
    } catch (err: any) {
      setTestResult({ type, status: 'error', message: err?.message || "连接后端服务失败" });
    } finally {
      setTesting(false);
      setTestVision(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-6">
          <RefreshCw className="w-10 h-10 animate-spin text-primary/40" />
          <p className="text-[11px] font-black uppercase tracking-[0.4em] text-on-surface-variant/40 animate-pulse">Synchronizing Core Engine...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-surface overflow-hidden">
      {/* Header */}
      <header className="h-24 border-b border-on-surface/5 px-10 flex items-center justify-between shrink-0 bg-white/60 backdrop-blur-2xl z-20">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="w-12 h-12 rounded-2xl bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-white border border-on-surface/5 transition-all shadow-sm active:scale-95 group"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          </Link>
          <div className="space-y-1">
             <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black font-headline text-on-surface tracking-tight leading-none">系统设置</h1>
                {isDirty && (
                  <span className="px-2 py-0.5 rounded bg-warning-container/20 text-warning text-[11px] font-black uppercase tracking-widest border border-warning/10 animate-pulse">
                    未保存更改
                  </span>
                )}
             </div>
             <p className="text-[11px] text-on-surface-variant font-bold uppercase tracking-[0.15em] opacity-40">配置您的 AI 整理引擎与服务偏好</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <AnimatePresence>
            {success && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-emerald-600 text-[11px] font-black uppercase tracking-wider bg-emerald-500/5 px-4 py-2 rounded-full border border-emerald-500/10"
              >
                <CheckCircle2 className="w-4 h-4" />
                {success}
              </motion.div>
            )}
          </AnimatePresence>
          <Button
            onClick={handleSave}
            disabled={saving || !isDirty}
            loading={saving}
            variant={isDirty ? "primary" : "secondary"}
            className="px-8 py-3.5"
          >
            {saving ? "正在同步..." : "保存当前配置"}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar: Profiles */}
        <aside className="w-80 border-r border-on-surface/5 bg-surface-container-low/20 overflow-y-auto p-8 space-y-10 shrink-0">
            <div className="flex items-center justify-between px-2">
              <div className="space-y-1">
                <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-on-surface-variant/50 leading-none">方案预设</h2>
                <p className="text-[11px] text-on-surface-variant/30 font-bold uppercase italic">Global Profiles</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddProfile}
                className="w-10 h-10 p-0 rounded-xl"
                title="新建配置方案"
              >
                <Plus className="w-4 h-4" />
              </Button>
           </div>

           <nav className="space-y-2">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "group flex items-center justify-between px-5 py-4 rounded-[20px] transition-all cursor-pointer relative overflow-hidden border",
                    activeId === p.id
                      ? "bg-white text-on-surface shadow-md border-on-surface/5 font-black scale-[1.02] z-10"
                      : "text-on-surface-variant/50 hover:text-on-surface hover:bg-white/50 border-transparent font-bold"
                  )}
                  onClick={() => handleSwitchProfile(p.id)}
                >
                  <div className="flex items-center gap-3 truncate">
                    <div className={cn("w-2 h-2 rounded-full", activeId === p.id ? "bg-primary" : "bg-on-surface/10")} />
                    <span className="text-[13px] truncate pr-2 tracking-tight">{p.name}</span>
                  </div>

                  {p.id !== 'default' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProfile(p.id, p.name);
                      }}
                      className="opacity-0 group-hover:opacity-40 hover:text-error hover:opacity-100 p-1.5 transition-all rounded-lg hover:bg-error/5"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
           </nav>

           <div className="p-6 bg-primary/5 rounded-3xl border border-primary/10 space-y-3">
              <div className="flex items-center gap-2 text-primary">
                <Info className="w-4 h-4 shrink-0" />
                <span className="text-[11px] font-black uppercase tracking-wider">关于多方案</span>
              </div>
              <p className="text-[11px] leading-relaxed text-on-surface-variant/70 font-medium">
                您可以为不同的任务（如：办公文档、海量下载、项目归档）创建独立的 AI 推理方案，从而在精度与成本间取得平衡。
              </p>
           </div>
        </aside>

        {/* Right Content: Details */}
        <main className="flex-1 overflow-y-auto p-16 space-y-20 scrollbar-thin scroll-smooth bg-surface/30">
          {error && <ErrorAlert message={error} />}

          {/* Unified LLM Section */}
          <section className="space-y-12">
             <div className="flex items-start justify-between border-b border-on-surface/5 pb-6">
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-2xl bg-primary shadow-xl shadow-primary/20 flex items-center justify-center text-white border border-primary/20">
                    <Cpu className="w-7 h-7" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-lg font-black font-headline text-on-surface tracking-tight uppercase tracking-widest leading-none">集成智能推理 (Base LLM)</h2>
                    <p className="text-[11px] text-on-surface-variant font-bold uppercase tracking-widest opacity-40">定义系统最核心的语义理解能力与对话逻辑</p>
                  </div>
                </div>
                <Button
                  onClick={() => handleTest('text')}
                  disabled={testing}
                  loading={testing}
                  variant="secondary"
                  size="sm"
                  className="px-6 py-2.5"
                >
                  测试连接
                </Button>
             </div>

             {testResult?.type === 'text' && (
               <div className={cn(
                 "p-6 rounded-2xl border-2 text-[12px] flex items-center gap-4 animate-in fade-in zoom-in-95",
                 testResult.status === 'success' ? "bg-emerald-500/5 border-emerald-500/10 text-emerald-800" : "bg-red-500/5 border-red-500/10 text-red-800"
               )}>
                 {testResult.status === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                 <p className="font-bold tracking-tight">{testResult.message}</p>
               </div>
             )}

            <div className="space-y-10 max-w-5xl">
              <div className="flex flex-col gap-4">
                <label className="text-[11px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1 flex items-center gap-2 opacity-50">
                  <Edit3 className="w-3.5 h-3.5" /> 方案显示名称
                </label>
                <div className="space-y-2">
                  <input
                    value={config.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    className="bg-white border border-on-surface/8 p-5 rounded-2xl text-[15px] font-black text-on-surface focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all shadow-sm w-full"
                    placeholder="例如: GPT-4o 默认生产方案"
                  />
                  <p className="px-2 text-[11px] text-on-surface-variant/40 font-medium italic">* 此名称将显示在侧边栏和所有的会话面板中。</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10 pt-4">
                <div className="space-y-10">
                  <div className="flex flex-col gap-4">
                    <label className="text-[11px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1 opacity-50">接口代理地址 / Base URL</label>
                    <div className="flex items-center gap-2 bg-white border border-on-surface/8 p-1.5 rounded-2xl focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/5 transition-all group">
                      <div className="px-3 opacity-20 group-focus-within:opacity-100 transition-opacity">
                        <Globe className="w-4 h-4" />
                      </div>
                      <input
                        value={config.OPENAI_BASE_URL}
                        onChange={(e) => handleChange('OPENAI_BASE_URL', e.target.value)}
                        className="flex-1 bg-transparent py-3.5 text-sm font-mono font-bold text-on-surface outline-none"
                        placeholder="https://api.openai.com/v1"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    <label className="text-[11px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1 opacity-50">API 访问密钥 / Key</label>
                    <div className="relative flex items-center bg-white border border-on-surface/8 p-1.5 rounded-2xl focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/5 transition-all group shadow-sm">
                      <div className="px-3 opacity-20 group-focus-within:opacity-100 transition-opacity">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <input
                        type={showKey ? "text" : "password"}
                        value={config.OPENAI_API_KEY}
                        onChange={(e) => handleChange('OPENAI_API_KEY', e.target.value)}
                        className="flex-1 bg-transparent py-3.5 text-sm font-mono font-bold text-on-surface outline-none pr-12"
                        placeholder="sk-..."
                      />
                      <button
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-4 p-2 text-on-surface-variant/20 hover:text-on-surface transition-colors"
                      >
                        {showKey ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-10">
                  <div className="flex flex-col gap-4 h-full">
                    <label className="text-[11px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1 opacity-50">推理模型 ID / Model</label>
                    <div className="space-y-4 h-full flex flex-col justify-between">
                      <div className="flex items-center gap-2 bg-white border border-on-surface/8 p-1.5 rounded-2xl focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/5 transition-all group shadow-sm">
                        <div className="px-3 opacity-20 group-focus-within:opacity-100 transition-opacity">
                          <Terminal className="w-4 h-4" />
                        </div>
                        <input
                          value={config.OPENAI_MODEL}
                          onChange={(e) => handleChange('OPENAI_MODEL', e.target.value)}
                          className="flex-1 bg-transparent py-3.5 text-sm font-black text-on-surface outline-none"
                          placeholder="gpt-4o"
                        />
                      </div>
                      <div className="flex-1 p-6 bg-surface-container-low/40 rounded-3xl border border-dashed border-on-surface/5 flex flex-col justify-center gap-2">
                        <p className="text-[11px] font-bold text-on-surface-variant leading-relaxed">
                          建议使用具备良好长文本遵循能力（Reasoning/Following）的模型，以获得更精准的目录结构建议。
                        </p>
                        <p className="text-[11px] text-primary/60 font-black uppercase tracking-[0.2em] italic">Structural Logic Engine</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Vision Section */}
          <section className="space-y-12">
             <div className="flex items-start justify-between border-b border-on-surface/5 pb-6">
                <div className="flex items-center gap-5">
                  <div className={cn(
                    "w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-700 border shadow-lg",
                    config.IMAGE_ANALYSIS_ENABLED 
                      ? "bg-on-surface text-white border-on-surface/5 shadow-on-surface/20" 
                      : "bg-surface-container-low text-on-surface-variant/10 border-on-surface/5 shadow-none"
                  )}>
                    <Globe className="w-7 h-7" />
                  </div>
                  <div className="space-y-1">
                    <h2 className={cn("text-lg font-black font-headline tracking-tight uppercase tracking-widest leading-none transition-colors", config.IMAGE_ANALYSIS_ENABLED ? "text-on-surface" : "text-on-surface-variant/30")}>
                      多模态视觉扩展 (Vision System)
                    </h2>
                    <p className="text-[11px] text-on-surface-variant font-bold uppercase tracking-widest opacity-40">允许 AI 直接“阅读”图片、绘图与扫描件内容以优化分类</p>
                  </div>
                </div>

                <div className="flex items-center gap-8">
                   {config.IMAGE_ANALYSIS_ENABLED && (
                      <Button 
                        onClick={() => handleTest('vision')}
                        disabled={testVision}
                        loading={testVision}
                        variant="secondary"
                        size="sm"
                        className="px-6 py-2.5"
                      >
                        验证视觉链路
                      </Button>
                   )}
                   <div className="flex items-center gap-3">
                      <span className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-widest">服务开关</span>
                      <button 
                        onClick={() => handleChange('IMAGE_ANALYSIS_ENABLED', !config.IMAGE_ANALYSIS_ENABLED)}
                        className={cn(
                          "relative inline-flex h-7 w-12 items-center rounded-full transition-all focus:outline-none p-1.5",
                          config.IMAGE_ANALYSIS_ENABLED ? "bg-primary shadow-lg shadow-primary/20" : "bg-surface-container-highest"
                        )}
                      >
                        <span className={cn("inline-block h-4 h-4 transform rounded-full bg-white transition-transform duration-300", config.IMAGE_ANALYSIS_ENABLED ? "translate-x-5" : "translate-x-0")} />
                      </button>
                   </div>
                </div>
             </div>

             {testResult?.type === 'vision' && (
               <div className={cn(
                 "p-6 rounded-2xl border-2 text-[12px] flex items-center gap-4 animate-in fade-in zoom-in-95",
                 testResult.status === 'success' ? "bg-emerald-500/5 border-emerald-500/10 text-emerald-800" : "bg-red-500/5 border-red-500/10 text-red-800"
               )}>
                 {testResult.status === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                 <p className="font-bold tracking-tight">{testResult.message}</p>
               </div>
             )}

             <div className={cn(
               "grid grid-cols-1 md:grid-cols-2 gap-12 transition-all duration-700 max-w-5xl",
               !config.IMAGE_ANALYSIS_ENABLED && "opacity-15 pointer-events-none grayscale blur-[2px]"
             )}>
                <div className="flex flex-col gap-4">
                  <label className="text-[11px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1 opacity-50">独立视觉 API 地址</label>
                  <div className="flex items-center gap-2 bg-white border border-on-surface/8 p-1.5 rounded-2xl focus-within:border-primary transition-all shadow-sm">
                    <div className="px-3 opacity-20">
                      <Globe className="w-4 h-4" />
                    </div>
                    <input 
                      value={config.IMAGE_ANALYSIS_BASE_URL}
                      onChange={(e) => handleChange('IMAGE_ANALYSIS_BASE_URL', e.target.value)}
                      className="flex-1 bg-transparent py-3.5 text-sm font-mono font-bold text-on-surface outline-none"
                      placeholder="留空即继承主推理接口地址"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <label className="text-[11px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1 opacity-50">独立视觉 API 密钥</label>
                  <div className="relative flex items-center bg-white border border-on-surface/8 p-1.5 rounded-2xl focus-within:border-primary transition-all shadow-sm">
                    <div className="px-3 opacity-20">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <input 
                      type={showVisionKey ? "text" : "password"}
                      value={config.IMAGE_ANALYSIS_API_KEY}
                      onChange={(e) => handleChange('IMAGE_ANALYSIS_API_KEY', e.target.value)}
                      className="flex-1 bg-transparent py-3.5 text-sm font-mono font-bold text-on-surface outline-none pr-12"
                      placeholder="留空即继承主推理密钥"
                    />
                    <button 
                      onClick={() => setShowVisionKey(!showVisionKey)}
                      className="absolute right-4 p-2 text-on-surface-variant/20 hover:text-on-surface transition-colors"
                    >
                      {showVisionKey ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-4 md:col-span-2">
                  <label className="text-[11px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1 opacity-50">视觉专用模型 ID</label>
                  <div className="flex items-center gap-2 bg-white border border-on-surface/8 p-1.5 rounded-2xl focus-within:border-primary transition-all shadow-sm">
                    <div className="px-3 opacity-20">
                      <Terminal className="w-4 h-4" />
                    </div>
                    <input 
                      value={config.IMAGE_ANALYSIS_MODEL}
                      onChange={(e) => handleChange('IMAGE_ANALYSIS_MODEL', e.target.value)}
                      className="flex-1 bg-transparent py-3.5 text-sm font-black text-on-surface outline-none"
                      placeholder="例如: gpt-4o 或 gpt-4-vision-preview"
                    />
                  </div>
                  <p className="px-2 text-[11px] text-on-surface-variant/40 font-medium">* 开启后，扫描速度将受限于多模态接口的响应延迟。</p>
                </div>
             </div>
          </section>

          {/* System Flags */}
          <section className="space-y-12">
             <div className="flex items-center gap-5 border-b border-on-surface/5 pb-6 opacity-40">
                <div className="w-14 h-14 rounded-2xl bg-surface-container-low flex items-center justify-center border border-on-surface/5">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                   <h2 className="text-lg font-black font-headline tracking-tight uppercase tracking-widest leading-none">系统调度与开发者协议</h2>
                   <p className="text-[11px] font-bold uppercase tracking-widest">底层实验性特性控制</p>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="bg-white p-8 rounded-3xl border border-on-surface/8 shadow-sm flex items-center justify-between group hover:border-primary/20 transition-all">
                  <div className="space-y-2 px-1">
                    <h3 className="text-[14px] font-black text-on-surface tracking-tight uppercase">全量日志调试 (Full Debug)</h3>
                    <p className="text-[11px] text-on-surface-variant/50 font-bold leading-relaxed max-w-xs">
                      在 `logs/` 目录下保存每一次 AI 对话的原始流量。用于排查分类质量和解析故障。
                    </p>
                  </div>
                  <button 
                    onClick={() => handleChange('DEBUG_MODE', !config.DEBUG_MODE)}
                    className={cn(
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-all focus:outline-none p-1",
                      config.DEBUG_MODE ? "bg-on-surface" : "bg-surface-container-highest"
                    )}
                  >
                    <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300", config.DEBUG_MODE ? "translate-x-5" : "translate-x-0")} />
                  </button>
                </div>

                 <div className="p-8 rounded-3xl border border-dashed border-on-surface/10 flex items-center gap-5 opacity-40">
                  <Terminal className="w-8 h-8 text-on-surface-variant/20" />
                  <div className="space-y-1">
                    <p className="text-[11px] font-black text-on-surface-variant uppercase tracking-widest">其他高级配置</p>
                    <p className="text-[11px] font-medium text-on-surface-variant">更多底层线程与缓存控制请参考项目 `config.yaml` 文件。</p>
                  </div>
                </div>
             </div>
          </section>

          {/* Static Footer */}
          <footer className="pt-24 pb-16 flex flex-col items-center">
              <div className="w-24 h-24 rounded-3xl bg-surface-container-low flex items-center justify-center text-on-surface-variant/5 rotate-12 group hover:rotate-0 transition-all duration-[1500ms] cursor-default active:scale-90">
                 <SettingsIcon className="w-12 h-12" />
              </div>
              <div className="mt-12 text-center space-y-2">
                 <p className="text-[11px] text-on-surface-variant/20 font-black uppercase tracking-[0.5em]">Antigravity Engine - File OS Layer</p>
                 <p className="text-[11px] text-on-surface-variant/10 font-bold uppercase tracking-widest">Built for Precision Reconstruction</p>
              </div>
          </footer>
        </main>
      </div>

      {/* Internal Modal System */}
      <AnimatePresence>
        {dialog && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
              onClick={() => setDialog(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-[480px] bg-white rounded-[32px] p-10 shadow-2xl overflow-hidden border border-on-surface/5"
            >
              <div className="space-y-6">
                 <div className="space-y-2">
                   <h3 className="text-xl font-black font-headline text-on-surface tracking-tight">{dialog.title}</h3>
                   <p className="text-[14px] text-on-surface-variant leading-relaxed font-medium opacity-80">{dialog.message}</p>
                 </div>

                 {dialog.type === 'prompt' && (
                   <input 
                     autoFocus
                     className="w-full bg-surface-container-low border border-on-surface/8 p-5 rounded-2xl text-[15px] font-bold text-on-surface focus:border-primary outline-none transition-all shadow-sm"
                     value={dialog.value}
                     onChange={(e) => setDialog({...dialog, value: e.target.value})}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter') dialog.onConfirm(dialog.value);
                     }}
                   />
                 )}

                 <div className="flex items-center gap-3 pt-4">
                   <Button 
                     variant="secondary"
                     onClick={() => setDialog(null)}
                     className="flex-1 py-4"
                   >
                     取消
                   </Button>
                   <Button 
                     variant="primary"
                     onClick={() => dialog.onConfirm(dialog.value)}
                     className="flex-1 py-4"
                   >
                     {dialog.type === 'confirm' ? '确定执行' : '立即创建'}
                   </Button>
                 </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
