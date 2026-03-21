import type { SessionEvent } from "@/types/session";

function buildEventsUrl(baseUrl: string, sessionId: string): string {
  return new URL(
    `/api/sessions/${sessionId}/events`,
    baseUrl.replace(/\/$/, "") + "/",
  ).toString();
}

export interface SessionEventStream {
  close(): void;
}

export interface CreateSessionEventStreamOptions {
  baseUrl: string;
  sessionId: string;
  onEvent: (event: SessionEvent) => void;
  onError?: (error: Event) => void;
}

export function createSessionEventStream(
  options: CreateSessionEventStreamOptions,
): SessionEventStream {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    return {
      close() {
        return;
      },
    };
  }

  const source = new EventSource(buildEventsUrl(options.baseUrl, options.sessionId));
  const eventTypes = [
    "session.snapshot",
    "session.created",
    "session.resumed",
    "session.stale",
    "scan.started",
    "scan.completed",
    "plan.updated",
    "precheck.ready",
    "execution.started",
    "execution.completed",
    "rollback.started",
    "rollback.completed",
    "session.error",
    "scan.action",
    "plan.action",
    "plan.ai_typing",
  ];

  const handleMessage = (message: MessageEvent<string>) => {
    try {
      const event = JSON.parse(message.data) as SessionEvent;
      options.onEvent(event);
    } catch {
      // Ignore malformed event payloads in the skeleton client.
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
