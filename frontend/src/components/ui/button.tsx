"use client";

import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
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
    primary: "bg-primary text-white shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95",
    secondary: "bg-surface-container-low border border-on-surface/5 text-on-surface-variant hover:bg-white hover:shadow-sm active:scale-95",
    danger: "bg-error-container/10 border border-error/10 text-error hover:bg-error hover:text-white active:scale-95",
    ghost: "bg-transparent text-on-surface-variant hover:bg-on-surface/5 active:scale-95"
  };

  const sizes = {
    sm: "px-4 py-1.5 text-[11px] rounded-lg",
    md: "px-6 py-2.5 text-[13px] rounded-xl",
    lg: "px-10 py-4 text-sm rounded-2xl"
  };

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      disabled={disabled || loading}
      className={cn(
        "font-black uppercase tracking-widest transition-all inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none disabled:grayscale",
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
