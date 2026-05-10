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
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex flex-col items-center justify-center text-center p-8", className)}
    >
      <div className="group relative flex w-full max-w-[420px] flex-col items-center gap-6 px-8 py-12">
        <div className="flex h-16 w-16 items-center justify-center rounded-[20px] border border-on-surface/5 bg-on-surface/[0.025] text-on-surface/20 transition-colors group-hover:bg-primary/5 group-hover:text-primary/60">
          <Icon className="h-8 w-8 stroke-[1.5]" />
        </div>
        <div className="max-w-[320px] space-y-2">
          <h3 className="text-[17px] font-black tracking-tight text-on-surface">{title}</h3>
          <p className="text-[13px] font-medium leading-relaxed text-ui-muted opacity-60">{description}</p>
        </div>

        {children ? <div className="pt-2">{children}</div> : null}
      </div>
    </motion.div>
  );
}
