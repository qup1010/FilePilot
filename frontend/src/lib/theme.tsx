"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// 主题配置持久化到 localStorage
const STORAGE_KEY = "filepilot-theme";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  mode: ThemeMode;
  /** 实际生效的主题（system 会解析为 light 或 dark） */
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  resolved: "light",
  setMode: () => {},
});

/** 从系统偏好读取当前是否深色 */
function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 读取持久化的主题偏好 */
function getStoredMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

/** 将 .dark 类应用到 <html> 元素，同时更新 color-scheme */
function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  } else {
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  }
}

function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return getSystemPreference();
  }
  return mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 懒初始化：客户端首次渲染即读取持久化偏好，与 layout.tsx 中的
  // 阻塞式内联脚本保持一致，避免深色模式启动闪烁（FOUC）。
  // getStoredMode / resolve 内部已做 SSR 保护（window 不存在时返回默认值）。
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredMode());
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(getStoredMode()));

  // 挂载后确保 DOM 状态与 React 状态一致（内联脚本通常已提前应用）
  useEffect(() => {
    const stored = getStoredMode();
    const r = resolve(stored);
    setModeState(stored);
    setResolved(r);
    applyTheme(r);
  }, []);

  // 监听系统主题变化（仅在 mode === "system" 时有效）
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (mode === "system") {
        const r = getSystemPreference();
        setResolved(r);
        applyTheme(r);
      }
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [mode]);

  const setMode = useCallback((nextMode: ThemeMode) => {
    const r = resolve(nextMode);
    setModeState(nextMode);
    setResolved(r);
    applyTheme(r);
    window.localStorage.setItem(STORAGE_KEY, nextMode);
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
