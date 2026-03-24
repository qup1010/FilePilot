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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex flex-col items-center justify-center text-center p-16 space-y-8", className)}
    >
      <div className="w-16 h-16 rounded-[24px] bg-surface-container-low border border-on-surface/5 flex items-center justify-center text-on-surface-variant/20 shadow-sm transition-transform hover:scale-110 duration-500">
        <Icon className="w-8 h-8" />
      </div>
      <div className="space-y-3 max-w-[320px]">
        <h3 className="text-lg font-black font-headline text-on-surface tracking-tight leading-tight">{title}</h3>
        <p className="text-[13px] text-on-surface-variant/60 leading-relaxed font-medium">{description}</p>
      </div>
      {children && (
        <div className="pt-2 animate-in fade-in slide-in-from-bottom-2 duration-700 delay-300 fill-mode-both">
          {children}
        </div>
      )}
    </motion.div>
  );
}
