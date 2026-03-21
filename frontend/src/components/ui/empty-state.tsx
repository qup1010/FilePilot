"use client";

import { motion } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Empty State (Architectural Style) ---
export function EmptyState({ 
  icon: Icon, 
  title, 
  description, 
  className 
}: { 
  icon: any; 
  title: string; 
  description: string; 
  className?: string; 
}) {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn("flex flex-col items-center justify-center text-center p-12 space-y-6", className)}
    >
      <div className="w-12 h-12 rounded-md bg-surface-container-highest flex items-center justify-center text-outline-variant transition-colors">
        <Icon className="w-6 h-6 opacity-30" />
      </div>
      <div className="space-y-2">
        <h3 className="text-base font-bold font-headline text-on-surface tracking-tight">{title}</h3>
        <p className="text-xs text-on-surface-variant max-w-[240px] leading-relaxed font-sans">{description}</p>
      </div>
    </motion.div>
  );
}
