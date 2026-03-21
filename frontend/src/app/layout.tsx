import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { AppShell } from "../components/app-shell";

export const metadata: Metadata = {
  title: "File Organizer Desktop",
  description: "AI-powered file organization workbench.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-surface font-sans antialiased text-on-surface select-none overflow-hidden">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
