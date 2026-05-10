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

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
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
