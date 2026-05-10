"use client";

import { invokeTauriCommand, isTauriDesktop } from "@/lib/runtime";

export function isWorkspaceForeground(): boolean {
  if (typeof document === "undefined") {
    return true;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

export async function requestWorkspaceNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (isTauriDesktop()) {
    return "granted";
  }
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission !== "default") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function notifyWorkspaceWhenAway(title: string, body: string, tag: string): void {
  if (typeof window === "undefined") {
    return;
  }
  if (isTauriDesktop()) {
    void invokeTauriCommand<boolean>("show_desktop_notification_when_away", { title, body }).catch((error) => {
      console.warn("Failed to show desktop notification", error);
    });
    return;
  }
  if (isWorkspaceForeground()) {
    return;
  }
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const notification = new Notification(title, {
    body,
    tag,
    icon: "/icon.png",
  });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}
