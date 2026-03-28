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
      className={cn("flex flex-col items-center justify-center text-center p-12", className)}
    >
      <div className="ui-panel flex w-full max-w-[460px] flex-col items-center gap-5 px-8 py-10">
        <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[14px] border border-on-surface/6 bg-surface-container-low text-primary/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
          <Icon className="h-9 w-9" />
        </div>
        <div className="max-w-[360px] space-y-2.5">
          <h3 className="text-[1.15rem] font-black font-headline tracking-tight text-on-surface">{title}</h3>
          <p className="text-[14px] leading-6 text-ui-subtle">{description}</p>
        </div>

        {children ? <div className="pt-1">{children}</div> : null}
      </div>
    </motion.div>
  );
}
