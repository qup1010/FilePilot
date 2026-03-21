"use client";

import { useEffect, useState } from "react";
import { 
  Server, Globe, Cpu, ArrowLeft, Terminal, ShieldCheck, 
  Settings as SettingsIcon, Info, Save, RefreshCw, CheckCircle2, AlertCircle, Eye, EyeOff,
  Plus, Trash2, ChevronDown, Copy, Edit3
} from "lucide-react";
import Link from "next/link";
import { getApiBaseUrl } from "@/lib/runtime";
import { ErrorAlert } from "@/components/ui/error-alert";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function SettingsPage() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [config, setConfig] = useState<any>(null);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testVision, setTestVision] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{type: 'text' | 'vision', status: 'success' | 'error', message: string} | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showVisionKey, setShowVisionKey] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/utils/config`);
      if (!res.ok) throw new Error("无法加载系统配置");
      const data = await res.json();
      setProfiles(data.profiles);
      setActiveId(data.active_id);
      setConfig(data.config);
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
      const res = await fetch(`${getApiBaseUrl()}/api/utils/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!res.ok) throw new Error("保存配置失败");
      setSuccess("当前方案设置已保存。");
      // 延时刷新同步脱敏状态
      setTimeout(fetchAll, 300);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchProfile = async (id: string) => {
    if (id === activeId) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/utils/config/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (!res.ok) throw new Error("切换方案失败");
      await fetchAll();
      setSuccess("已成功切换配置方案。");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddProfile = async () => {
    const name = window.prompt("请输入新方案名称：", "我的配置方案");
    if (!name) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/utils/config/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, copy: true })
      });
      if (!res.ok) throw new Error("新增方案失败");
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProfile = async (id: string, name: string) => {
    if (id === "default") {
      alert("默认方案不能删除。");
      return;
    }
    if (!window.confirm(`确认要删除配置方案 "${name}" 吗？`)) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/utils/config/profiles/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error("删除方案失败");
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async (type: 'text' | 'vision') => {
    if (type === 'text') setTesting(true); else setTestVision(true);
    setTestResult(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/utils/test-llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, test_type: type })
      });
      const data = await res.json();
      setTestResult({ 
        type, 
        status: data.status === 'ok' ? 'success' : 'error', 
        message: data.message 
      });
    } catch (err: any) {
      setTestResult({ type, status: 'error', message: "连接后端服务失败" });
    } finally {
      setTesting(false);
      setTestVision(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4 opacity-20">
          <RefreshCw className="w-8 h-8 animate-spin" />
          <p className="text-[10px] font-black uppercase tracking-widest italic">Synchronizing Core Engine...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-surface overflow-hidden">
      {/* Header */}
      <header className="h-24 border-b border-on-surface/5 px-10 flex items-center justify-between shrink-0 bg-white/40 backdrop-blur-xl z-20">
        <div className="flex items-center gap-6">
          <Link 
            href="/" 
            className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-white border border-on-surface/5 transition-all shadow-sm active:scale-95 group"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
               <h1 className="text-xl font-black font-headline text-on-surface tracking-tight uppercase tracking-widest leading-none">Settings</h1>
               <div className="h-4 w-px bg-on-surface/10" />
               <p className="text-[11px] text-on-surface-variant font-bold uppercase tracking-widest opacity-60">System Core</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-[11px] font-black uppercase tracking-wider animate-in fade-in slide-in-from-right-3">
              <CheckCircle2 className="w-4 h-4" />
              {success}
            </div>
          )}
          <button 
            onClick={handleSave}
            disabled={saving}
            className="bg-on-surface text-surface px-7 py-3 rounded-lg text-xs font-black uppercase tracking-widest shadow-xl shadow-on-surface/10 hover:opacity-90 active:scale-95 transition-all flex items-center gap-3 disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin text-surface/50" /> : <Save className="w-4 h-4" />}
            Save active configuration
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar: Profiles */}
        <aside className="w-72 border-r border-on-surface/5 bg-surface-container-low/30 overflow-y-auto p-6 space-y-8 shrink-0">
           <div className="flex items-center justify-between px-2">
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-on-surface-variant/40">Configuration Profiles</h2>
              <button 
                onClick={handleAddProfile}
                className="p-1 hover:bg-on-surface/5 rounded transition-colors text-primary"
                title="新建方案"
              >
                <Plus className="w-4 h-4" />
              </button>
           </div>

           <nav className="space-y-1">
              {profiles.map((p) => (
                <div 
                  key={p.id}
                  className={cn(
                    "group flex items-center justify-between px-4 py-3.5 rounded-lg transition-all cursor-pointer relative overflow-hidden",
                    activeId === p.id 
                      ? "bg-white text-on-surface shadow-sm border border-on-surface/5 font-black" 
                      : "text-on-surface-variant/50 hover:text-on-surface hover:bg-on-surface/5 font-bold"
                  )}
                  onClick={() => handleSwitchProfile(p.id)}
                >
                  {activeId === p.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                  <span className="text-[12px] truncate pr-2 tracking-tight">{p.name}</span>
                  
                  {p.id !== 'default' && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProfile(p.id, p.name);
                      }}
                      className="opacity-0 group-hover:opacity-40 hover:text-error hover:opacity-100 p-1 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
           </nav>
        </aside>

        {/* Right Content: Details */}
        <main className="flex-1 overflow-y-auto p-12 space-y-16 scrollbar-thin scroll-smooth">
          {error && <ErrorAlert message={error} />}

          {/* Unified LLM Section */}
          <section className="space-y-10">
             <div className="flex items-center justify-between border-b border-on-surface/5 pb-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shadow-sm border border-primary/5">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-on-surface">Integrated Intelligence</h2>
                    <p className="text-[10px] text-on-surface-variant/40 font-bold uppercase tracking-widest mt-0.5">Core Text Reasoning Pathway</p>
                  </div>
                </div>
                <button 
                  onClick={() => handleTest('text')}
                  disabled={testing}
                  className="bg-white border border-on-surface/5 px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest text-on-surface-variant hover:text-primary transition-all flex items-center gap-2 hover:shadow-sm"
                >
                  {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  Verify Text Link
                </button>
             </div>

             {testResult?.type === 'text' && (
               <div className={cn(
                 "p-5 rounded-lg border-2 text-[11px] flex items-start gap-3 animate-in fade-in zoom-in-95",
                 testResult.status === 'success' ? "bg-emerald-50/50 border-emerald-100 text-emerald-800" : "bg-red-50/50 border-red-100 text-red-800"
               )}>
                 {testResult.status === 'success' ? <CheckCircle2 className="w-4.5 h-4.5 shrink-0" /> : <AlertCircle className="w-4.5 h-4.5 shrink-0" />}
                 <p className="font-bold tracking-tight">{testResult.message}</p>
               </div>
             )}

             <div className="space-y-8">
               <div className="flex flex-col gap-3">
                  <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1 group flex items-center gap-2">
                    <Edit3 className="w-3 h-3 opacity-30" /> Scheme Name
                  </label>
                  <input 
                    value={config.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    className="bg-surface-container-low border border-on-surface/5 p-5 rounded-xl text-[14px] font-bold text-on-surface focus:border-primary outline-none transition-all shadow-xs w-full max-w-xl"
                    placeholder="例如: GPT-4o 极速版"
                  />
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="space-y-8">
                    <div className="flex flex-col gap-3">
                        <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1">Endpoint Base URL</label>
                        <div className="flex items-center gap-2 bg-surface-container-low border border-on-surface/5 p-1 rounded-xl focus-within:border-primary transition-all group">
                           <div className="px-3 opacity-20 group-focus-within:opacity-100 transition-opacity">
                              <Globe className="w-4 h-4" />
                           </div>
                           <input 
                             value={config.OPENAI_BASE_URL}
                             onChange={(e) => handleChange('OPENAI_BASE_URL', e.target.value)}
                             className="flex-1 bg-transparent py-4 text-sm font-mono text-on-surface outline-none"
                             placeholder="https://api.openai.com/v1"
                           />
                        </div>
                    </div>
                    
                    <div className="flex flex-col gap-3">
                        <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1">Access Token (API Key)</label>
                        <div className="relative flex items-center bg-surface-container-low border border-on-surface/5 p-1 rounded-xl focus-within:border-primary transition-all group">
                           <div className="px-3 opacity-20 group-focus-within:opacity-100 transition-opacity">
                              <ShieldCheck className="w-4 h-4" />
                           </div>
                           <input 
                             type={showKey ? "text" : "password"}
                             value={config.OPENAI_API_KEY}
                             onChange={(e) => handleChange('OPENAI_API_KEY', e.target.value)}
                             className="flex-1 bg-transparent py-4 text-sm font-mono text-on-surface outline-none pr-12"
                             placeholder="sk-..."
                           />
                           <button 
                             onClick={() => setShowKey(!showKey)}
                             className="absolute right-4 p-2 text-on-surface-variant/30 hover:text-on-surface-variant transition-colors"
                           >
                             {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                           </button>
                        </div>
                    </div>
                  </div>

                  <div className="space-y-8">
                     <div className="flex flex-col gap-3">
                        <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1">Consolidated Model Name</label>
                        <div className="flex items-center gap-2 bg-surface-container-low border border-on-surface/5 p-1 rounded-xl focus-within:border-primary transition-all group">
                           <div className="px-3 opacity-20 group-focus-within:opacity-100 transition-opacity">
                              <Terminal className="w-4 h-4" />
                           </div>
                           <input 
                              value={config.OPENAI_MODEL}
                              onChange={(e) => handleChange('OPENAI_MODEL', e.target.value)}
                              className="flex-1 bg-transparent py-4 text-sm font-bold text-on-surface outline-none"
                              placeholder="gpt-4o"
                           />
                        </div>
                        <p className="text-[10px] text-on-surface-variant/30 font-bold px-1 italic">此模型将同时承担深度扫描分析与重组指令生成。</p>
                     </div>

                     <div className="p-6 bg-surface-container-low/40 rounded-xl border border-dashed border-on-surface/5 flex items-center justify-center h-[106px]">
                        <div className="text-center group">
                           <p className="text-[11px] font-bold text-on-surface-variant group-hover:text-primary transition-colors">切换方案可以快速尝试不同服务商</p>
                           <p className="text-[9px] text-on-surface-variant/30 mt-1 uppercase tracking-widest font-black">Multi-Profile Architecture</p>
                        </div>
                     </div>
                  </div>
               </div>
             </div>
          </section>

          {/* Vision Section */}
          <section className="space-y-10">
             <div className="flex items-center justify-between border-b border-on-surface/5 pb-4">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shadow-sm border transition-all",
                    config.IMAGE_ANALYSIS_ENABLED ? "bg-on-surface text-surface border-on-surface/5" : "bg-surface-container-low text-on-surface-variant/20 border-on-surface/5"
                  )}>
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className={cn("text-[11px] font-black uppercase tracking-[0.3em] transition-colors", config.IMAGE_ANALYSIS_ENABLED ? "text-on-surface" : "text-on-surface-variant/40")}>Multimodal Vision Expansion</h2>
                    <p className="text-[10px] text-on-surface-variant/40 font-bold uppercase tracking-widest mt-0.5">Image Understanding Layer</p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                   {config.IMAGE_ANALYSIS_ENABLED && (
                      <button 
                        onClick={() => handleTest('vision')}
                        disabled={testVision}
                        className="bg-white border border-on-surface/5 px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest text-on-surface-variant hover:text-primary transition-all flex items-center gap-2 hover:shadow-sm"
                      >
                        {testVision ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Info className="w-3.5 h-3.5" />}
                        Verify Vision Link
                      </button>
                   )}
                   <button 
                    onClick={() => handleChange('IMAGE_ANALYSIS_ENABLED', !config.IMAGE_ANALYSIS_ENABLED)}
                    className={cn(
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-all focus:outline-none p-1",
                      config.IMAGE_ANALYSIS_ENABLED ? "bg-primary shadow-lg shadow-primary/20" : "bg-surface-container-highest"
                    )}
                   >
                     <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300", config.IMAGE_ANALYSIS_ENABLED ? "translate-x-5" : "translate-x-0")} />
                   </button>
                </div>
             </div>

             {testResult?.type === 'vision' && (
               <div className={cn(
                 "p-5 rounded-lg border-2 text-[11px] flex items-start gap-3 animate-in fade-in zoom-in-95",
                 testResult.status === 'success' ? "bg-emerald-50/50 border-emerald-100 text-emerald-800" : "bg-red-50/50 border-red-100 text-red-800"
               )}>
                 {testResult.status === 'success' ? <CheckCircle2 className="w-4.5 h-4.5 shrink-0" /> : <AlertCircle className="w-4.5 h-4.5 shrink-0" />}
                 <p className="font-bold tracking-tight">{testResult.message}</p>
               </div>
             )}

             <div className={cn(
               "grid grid-cols-1 md:grid-cols-2 gap-10 transition-all",
               !config.IMAGE_ANALYSIS_ENABLED && "opacity-20 pointer-events-none grayscale blur-[1px]"
             )}>
                <div className="flex flex-col gap-3">
                  <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1">Independent Vision API Base</label>
                  <div className="flex items-center gap-2 bg-surface-container-low border border-on-surface/5 p-1 rounded-xl focus-within:border-primary transition-all">
                    <div className="px-3 opacity-20">
                      <Globe className="w-4 h-4" />
                    </div>
                    <input 
                      value={config.IMAGE_ANALYSIS_BASE_URL}
                      onChange={(e) => handleChange('IMAGE_ANALYSIS_BASE_URL', e.target.value)}
                      className="flex-1 bg-transparent py-4 text-sm font-mono text-on-surface outline-none"
                      placeholder="Inherit from main endpoint"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1">Vision API Token</label>
                  <div className="relative flex items-center bg-surface-container-low border border-on-surface/5 p-1 rounded-xl focus-within:border-primary transition-all">
                    <div className="px-3 opacity-20">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <input 
                      type={showVisionKey ? "text" : "password"}
                      value={config.IMAGE_ANALYSIS_API_KEY}
                      onChange={(e) => handleChange('IMAGE_ANALYSIS_API_KEY', e.target.value)}
                      className="flex-1 bg-transparent py-4 text-sm font-mono text-on-surface outline-none pr-12"
                      placeholder="Inherit from main key"
                    />
                    <button 
                      onClick={() => setShowVisionKey(!showVisionKey)}
                      className="absolute right-4 p-2 text-on-surface-variant/30 hover:text-on-surface-variant transition-colors"
                    >
                      {showVisionKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-3 md:col-span-2">
                  <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] px-1">Vision-Capable Model</label>
                  <div className="flex items-center gap-2 bg-surface-container-low border border-on-surface/5 p-1 rounded-xl focus-within:border-primary transition-all">
                    <div className="px-3 opacity-20">
                      <Terminal className="w-4 h-4" />
                    </div>
                    <input 
                      value={config.IMAGE_ANALYSIS_MODEL}
                      onChange={(e) => handleChange('IMAGE_ANALYSIS_MODEL', e.target.value)}
                      className="flex-1 bg-transparent py-4 text-sm font-bold text-on-surface outline-none"
                      placeholder="例如: gpt-4o 或 claude-3-opus"
                    />
                  </div>
                </div>
             </div>
          </section>

          {/* System Flags */}
          <section className="space-y-10">
             <div className="flex items-center gap-4 border-b border-on-surface/5 pb-4 opacity-40">
                <div className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                   <h2 className="text-[11px] font-black uppercase tracking-[0.3em]">Hardware & Logs</h2>
                   <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5">Control Interface</p>
                </div>
             </div>

             <div className="flex items-center justify-between bg-white p-7 rounded-xl border border-on-surface/5 shadow-sm group hover:border-primary/20 transition-all">
                <div className="space-y-1.5 px-1">
                   <h3 className="text-sm font-black text-on-surface tracking-tight uppercase">Debugging Protocol</h3>
                   <p className="text-[11px] text-on-surface-variant/60 font-medium">开启深度 Prompt 追踪，日志将详细记录每一次大模型交互内容。</p>
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
          </section>

          {/* Static Footer */}
          <footer className="pt-16 pb-12 flex flex-col items-center">
              <div className="w-20 h-20 rounded-2xl bg-surface-container-low flex items-center justify-center text-on-surface-variant/5 rotate-12 group hover:rotate-0 transition-transform duration-700">
                 <SettingsIcon className="w-10 h-10" />
              </div>
              <div className="mt-8 text-center space-y-1">
                 <p className="text-[10px] text-on-surface-variant/20 font-black uppercase tracking-[0.5em]">Antigravity System Shell</p>
                 <p className="text-[9px] text-on-surface-variant/10 font-bold uppercase tracking-widest">Built for precision architecture</p>
              </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
