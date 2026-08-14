/**
 * 应用级上下文伪存储：统一管理"当前任务入口"相关的 localStorage 键与跨组件同步事件。
 *
 * 所有读写都通过这里，避免各组件重复声明键名/事件名并直接操作 localStorage。
 * 全部函数都带 SSR 守卫，可在服务端渲染路径安全调用。
 */

export const APP_CONTEXT_EVENT = "file-pilot-context-change";
export const ACTIVE_WORKSPACE_ROUTE_KEY = "workspace_active_route";
export const WORKSPACE_CONTEXT_KEY = "workspace_header_context";
export const RULES_CONTEXT_KEY = "rules_header_context";
export const HISTORY_CONTEXT_KEY = "history_header_context";

export function notifyAppContextChange(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
}

export function readActiveWorkspaceRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY);
}

export function rememberActiveWorkspaceRoute(route: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ACTIVE_WORKSPACE_ROUTE_KEY, route);
  notifyAppContextChange();
}

export function clearActiveWorkspaceRoute(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ACTIVE_WORKSPACE_ROUTE_KEY);
  notifyAppContextChange();
}

export function getSessionIdFromWorkspaceRoute(route: string | null): string | null {
  if (!route?.startsWith("/workspace")) {
    return null;
  }
  const query = route.split("?")[1] || "";
  return new URLSearchParams(query).get("session_id");
}

/**
 * 仅当当前记录的任务入口属于指定会话时才清除，返回是否发生了清除。
 */
export function clearActiveWorkspaceRouteForSession(sessionId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const storedRoute = window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY);
  if (getSessionIdFromWorkspaceRoute(storedRoute) !== sessionId) {
    return false;
  }
  window.localStorage.removeItem(ACTIVE_WORKSPACE_ROUTE_KEY);
  notifyAppContextChange();
  return true;
}

/**
 * 订阅应用内上下文变化：同时监听 APP_CONTEXT_EVENT（本标签页）与 storage（其他标签页）。
 * 返回取消订阅函数。
 */
export function subscribeAppContext(cb: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(APP_CONTEXT_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(APP_CONTEXT_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
