import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";

import "./globals.css";
import { AppShell } from "../components/app-shell";
import { ThemeProvider } from "@/lib/theme";

export const metadata: Metadata = {
  title: "FilePilot",
  description: "AI-powered file organization workbench.",
};

/**
 * 首帧前应用主题的阻塞式脚本，逻辑必须与 src/lib/theme.tsx 保持一致：
 * - localStorage key: "filepilot-theme"，合法值 "light" | "dark" | "system"（默认 "system"）
 * - "system" 通过 matchMedia("(prefers-color-scheme: dark)") 解析
 * - 深色时给 <html> 添加 .dark 并设置 colorScheme，避免启动闪烁（FOUC）
 */
const themeInitScript = `(function () {
  try {
    var stored = window.localStorage.getItem("filepilot-theme");
    var mode = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    var resolved = mode === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : mode;
    var root = document.documentElement;
    if (resolved === "dark") {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    }
  } catch (e) {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-surface font-sans antialiased text-on-surface overflow-hidden">
        <Suspense fallback={<main className="flex min-h-screen bg-surface" />}>
          <ThemeProvider>
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </Suspense>
      </body>
    </html>
  );
}
