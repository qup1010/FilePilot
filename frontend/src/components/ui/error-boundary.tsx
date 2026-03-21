"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children?: ReactNode;
  fallbackTitle?: string;
  className?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className={`p-10 flex flex-col items-center justify-center text-center space-y-4 bg-error-container/5 border border-error/10 rounded-md ${this.props.className}`}>
          <AlertTriangle className="w-8 h-8 text-error opacity-40" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-on-surface uppercase tracking-widest">{this.props.fallbackTitle || "渲染引擎异常"}</h3>
            <p className="text-xs text-on-surface-variant max-w-[300px] leading-relaxed">
              数据模型出现不一致，导致该面板无法正常渲染。您可以尝试刷新会话快照或联系开发团队。
            </p>
          </div>
          <button 
            onClick={() => this.setState({ hasError: false })}
            className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline"
          >
            重试渲染 (Retry)
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
