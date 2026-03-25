"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function EmptyState({ 
  icon: Icon, 
  title, 
  description, 
  className,
  children
}: { 
  icon: any; 
  title: string; 
  description: string; 
  className?: string; 
  children?: React.ReactNode;
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn("flex flex-col items-center justify-center text-center p-16 space-y-10", className)}
    >
      <div className="relative">
        <div className="w-20 h-20 rounded-xl bg-white border border-on-surface/[0.04] flex items-center justify-center text-primary/40 shadow-[0_8px_30px_rgba(0,0,0,0.04)] transition-all hover:scale-105 duration-500 group">
          <Icon className="w-10 h-10 transition-colors group-hover:text-primary/60" />
        </div>
        <motion.div 
          animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.3, 0.1] }}
          transition={{ duration: 4, repeat: Infinity }}
          className="absolute -inset-4 bg-primary/5 rounded-full blur-2xl -z-10"
        />
      </div>
      
      <div className="space-y-4 max-w-[360px]">
        <h3 className="text-xl font-black font-headline text-on-surface tracking-tighter leading-tight italic uppercase">{title}</h3>
        <p className="text-[14px] text-on-surface-variant/40 leading-relaxed font-bold tracking-tight">{description}</p>
      </div>
      
      {children && (
        <div className="pt-2 animate-in fade-in slide-in-from-bottom-3 duration-1000 delay-500 fill-mode-both">
          {children}
        </div>
      )}
    </motion.div>
  );
}
