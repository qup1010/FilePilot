"use client";

import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
}

export function Button({ 
  children, 
  variant = "primary", 
  size = "md", 
  loading, 
  className, 
  disabled,
  ...props 
}: ButtonProps) {
  const variants = {
    primary: "border border-primary/25 bg-primary text-white hover:bg-primary-dim",
    secondary: "border border-on-surface/12 bg-surface-container-lowest text-on-surface hover:bg-surface-container-high hover:border-primary/20",
    danger: "border border-error/25 bg-error-container/42 text-error hover:bg-error hover:text-white",
    ghost: "border border-transparent bg-transparent text-on-surface hover:bg-on-surface/5"
  };

  const sizes = {
    sm: "h-9 px-4 text-[12px] rounded-[6px]",
    md: "h-10 px-5 text-[13px] rounded-[6px]",
    lg: "h-11 px-6 text-[14px] rounded-[8px]",
    icon: "h-10 w-10 p-0 rounded-[8px]"
  };

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold tracking-[0.01em] transition-[transform,background-color,border-color,color] duration-180 disabled:pointer-events-none disabled:opacity-50 disabled:grayscale focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10",
        variants[variant],
        sizes[size],
        className
      )}
      {...props as any}
    >
      {loading && (
        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
      {children}
    </motion.button>
  );
}
