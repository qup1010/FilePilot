"use client";

import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import i18n from "@/i18n/instance";

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
            <h3 className="text-sm font-bold text-on-surface uppercase tracking-widest">{this.props.fallbackTitle || i18n.t("sharedUi.errorBoundary.title")}</h3>
            <p className="text-xs text-on-surface-variant max-w-[300px] leading-relaxed">
              {i18n.t("sharedUi.errorBoundary.description")}
            </p>
          </div>
          <button 
            onClick={() => this.setState({ hasError: false })}
            className="text-[11px] font-black uppercase tracking-widest text-primary hover:underline"
          >
            {i18n.t("sharedUi.errorBoundary.retry")}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
