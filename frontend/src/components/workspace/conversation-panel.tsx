"use client";

import React, { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Bot, User, Cpu, ChevronRight, Loader2, Send, AlertTriangle, Sparkles
} from "lucide-react";
import { AssistantMessage, SessionStage } from "@/types/session";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LogEntry {
  id: string;
  message: string;
  time: string;
  important?: boolean;
}

interface ConversationPanelProps {
  messages: AssistantMessage[];
  actionLog: LogEntry[];
  aiTyping: boolean;
  isBusy: boolean;
  stage: SessionStage;
  messageInput: string;
  setMessageInput: (val: string) => void;
  onSendMessage: () => void;
  onStartScan: () => void;
  unresolvedCount: number;
}

export function ConversationPanel({
  messages,
  actionLog,
  aiTyping,
  isBusy,
  stage,
  messageInput,
  setMessageInput,
  onSendMessage,
  onStartScan,
  unresolvedCount
}: ConversationPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, actionLog, aiTyping]);

  return (
    <div className="flex flex-col h-full bg-surface-container-low">
      {/* Messages Canvas */}
      <div className="flex-1 overflow-y-auto px-8 py-10 space-y-10 scroll-smooth">
        
        {/* Welcome / Initial State */}
        {(stage === "idle" || stage === "draft") && actionLog.length === 0 && (
           <motion.div initial={{opacity:0}} animate={{opacity:1}} className="flex gap-6 max-w-2xl">
              <div className="shrink-0 pt-1 text-primary/40"><Cpu className="w-5 h-5"/></div>
              <div className="space-y-4 font-sans">
                 <p className="text-sm leading-relaxed text-on-surface-variant italic">
                    我是你的文件架构助手。我可以协助识别碎片化文件，并按逻辑构建目标拓扑。点击下方启动架构扫描，或直接输入您的组织意向。
                 </p>
                 <button 
                   onClick={onStartScan} 
                   disabled={isBusy} 
                   className="inline-flex items-center gap-2 bg-linear-to-b from-primary to-primary-dim text-white px-6 py-2.5 rounded-md text-xs font-bold transition-transform active:scale-[0.98] shadow-sm disabled:opacity-50"
                 >
                   <Sparkles className="w-3.5 h-3.5" /> 开始架构深度扫描
                 </button>
              </div>
           </motion.div>
        )}

        {/* Message Thread */}
        {messages.map((msg, i) => {
          if (msg.role === 'system') return null;
          const isAI = msg.role === 'assistant';
          return (
            <motion.div 
              key={i} 
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className={cn("flex gap-6", isAI ? "flex-row" : "flex-row-reverse justify-start")}
            >
              <div className={cn(
                "w-8 h-8 rounded-md flex items-center justify-center shrink-0 border border-on-surface/5 shadow-sm",
                isAI ? "bg-white text-primary" : "bg-primary text-white"
              )}>
                {isAI ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </div>
              <div className={cn(
                "p-5 rounded-md text-[13px] leading-relaxed max-w-[85%] transition-all",
                isAI 
                  ? "bg-white text-on-surface shadow-sm border border-on-surface/5 whitespace-pre-wrap font-sans" 
                  : "bg-surface-container-highest text-on-surface font-medium"
              )}>
                {msg.content}
              </div>
            </motion.div>
          );
        })}

        {/* Action Log / Technical Thinking */}
        {actionLog.length > 0 && (
           <motion.div initial={{opacity: 0}} animate={{opacity: 1}} className="flex gap-6">
              <div className="w-8 h-8 rounded-md bg-white border border-on-surface/5 flex items-center justify-center text-outline-variant shrink-0 shadow-sm"><Cpu className="w-4 h-4"/></div>
              <div className="flex-1 pt-1">
                <details className="group" open={isBusy}>
                   <summary className="list-none cursor-pointer flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/40 hover:text-primary transition-colors select-none mb-6">
                      <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                      运行日志与思考轨迹
                      {isBusy && <Loader2 className="w-2.5 h-2.5 animate-spin ml-2" />}
                   </summary>
                   <div className="space-y-2 border-l border-on-surface/5 pl-6 ml-1.5 transition-all">
                      {actionLog.map(log => (
                        <div key={log.id} className="flex items-center gap-4 text-[10px] text-on-surface-variant/40 py-0.5 group/line font-mono">
                           <div className={cn("w-1 h-1 rounded-full", log.important ? "bg-primary" : "bg-outline-variant/30")} />
                           <span className={cn("truncate flex-1 tracking-tight", log.important ? "text-on-surface/70" : "")}>{log.message}</span>
                           <span className="opacity-20 text-[9px] tabular-nums whitespace-nowrap">{log.time}</span>
                        </div>
                      ))}
                   </div>
                </details>
              </div>
           </motion.div>
        )}

        {/* Thinking Indicator */}
        {aiTyping && (
           <motion.div initial={{opacity:0, y: 10}} animate={{opacity:1, y: 0}} className="flex gap-6">
              <div className="w-8 h-8 rounded-md bg-white border border-on-surface/5 flex items-center justify-center text-primary shrink-0 shadow-sm"><Bot className="w-4 h-4"/></div>
              <div className="p-4 bg-white border border-on-surface/5 rounded-md text-[13px] text-on-surface-variant italic flex items-center gap-3 shadow-sm shadow-black/5">
                 <div className="flex gap-1 items-center">
                   <span className="w-1 h-1 bg-primary/40 rounded-full animate-bounce" />
                   <span className="w-1 h-1 bg-primary/40 rounded-full animate-bounce [animation-delay:0.2s]" />
                   <span className="w-1 h-1 bg-primary/40 rounded-full animate-bounce [animation-delay:0.4s]" />
                 </div>
                 <span className="uppercase tracking-widest text-[10px] font-black opacity-30">思考中</span>
              </div>
           </motion.div>
        )}

        <div ref={scrollRef} className="h-6" />
      </div>

      {/* Action Composer */}
      {stage !== "completed" && stage !== "idle" && (
        <div className="px-8 py-6 flex flex-col justify-center bg-surface-container-low border-t border-on-surface/5 border-dashed">
           <AnimatePresence>
             {unresolvedCount > 0 && (
               <motion.div 
                 initial={{opacity:0, y: 10}} animate={{opacity:1, y: 0}} exit={{opacity:0, y: 10}}
                 className="mb-4 px-4 py-2 bg-on-surface/5 rounded text-[10px] font-bold text-on-surface-variant uppercase tracking-widest flex items-center gap-2 border border-on-surface/5"
               >
                  <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                  需要补充元数据描述 ({unresolvedCount} 项冲突)
               </motion.div>
             )}
           </AnimatePresence>

          <div className="relative flex items-center">
            <input 
              ref={inputRef}
              className="w-full bg-white border-l-2 border-transparent focus:border-primary rounded-md py-4 px-6 pr-16 text-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none transition-all disabled:opacity-50 shadow-sm shadow-black/5" 
              placeholder={isBusy ? "系统正在处理请求..." : "输入架构调整指令..."} 
              type="text"
              value={messageInput}
              disabled={isBusy}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSendMessage();
              }}
            />
            <button 
              onClick={onSendMessage}
              disabled={isBusy || !messageInput.trim()}
              className="absolute right-3 text-on-surface-variant hover:text-primary p-2 transition-colors disabled:opacity-20 flex items-center justify-center active:scale-90"
            >
              {isBusy ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4" />}
            </button>
          </div>
          
          <div className="mt-4 flex items-center justify-center gap-6 text-[9px] text-on-surface-variant/20 uppercase tracking-[0.3em] font-black pointer-events-none">
            <span>Conversational Engine</span>
            <div className="w-1 h-1 bg-on-surface-variant/10 rounded-full" />
            <span>Active Session {stage.toUpperCase()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
