import type { IconWorkbenchEvent } from "@/types/icon-workbench";

function buildEventsUrl(baseUrl: string, sessionId: string, accessToken?: string): string {
  const url = new URL(
    `/api/icon-workbench/sessions/${sessionId}/events`,
    baseUrl.replace(/\/$/, "") + "/",
  );
  if (accessToken) {
    url.searchParams.set("access_token", accessToken);
  }
  return url.toString();
}

export interface IconWorkbenchEventStream {
  close(): void;
}

export interface CreateIconWorkbenchEventStreamOptions {
  baseUrl: string;
  sessionId: string;
  accessToken?: string;
  onEvent: (event: IconWorkbenchEvent) => void;
  onError?: (error: Event) => void;
}

export function createIconWorkbenchEventStream(
  options: CreateIconWorkbenchEventStreamOptions,
): IconWorkbenchEventStream {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    return {
      close() {
        return;
      },
    };
  }

  const source = new EventSource(buildEventsUrl(options.baseUrl, options.sessionId, options.accessToken));
  const eventTypes = [
    "icon.session.snapshot",
    "icon.session.created",
    "icon.targets.updated",
    "icon.analysis.started",
    "icon.analysis.progress",
    "icon.analysis.completed",
    "icon.generation.started",
    "icon.generation.progress",
    "icon.generation.completed",
    "icon.version.deleted",
  ];

  const handleMessage = (message: MessageEvent<string>) => {
    try {
      const event = JSON.parse(message.data) as IconWorkbenchEvent;
      options.onEvent(event);
    } catch {
      return;
    }
  };

  source.onmessage = handleMessage;
  eventTypes.forEach((eventType) => {
    source.addEventListener(eventType, (message) => {
      handleMessage(message as MessageEvent<string>);
    });
  });
  source.onerror = (event) => {
    options.onError?.(event);
  };

  return {
    close() {
      source.close();
    },
  };
}
