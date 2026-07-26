import type { SessionEvent } from "@/types/session";

export interface EventStreamHandle {
  close(): void;
}

export interface CreateEventStreamOptions<TEvent> {
  baseUrl: string;
  /** Full events path, already including the session id. */
  path: string;
  accessToken?: string;
  eventTypes: readonly string[];
  onEvent: (event: TEvent) => void;
  onError?: (error: Event) => void;
}

function buildEventsUrl(baseUrl: string, path: string, accessToken?: string): string {
  const url = new URL(path, baseUrl.replace(/\/$/, "") + "/");
  if (accessToken) {
    url.searchParams.set("access_token", accessToken);
  }
  return url.toString();
}

export function createEventStream<TEvent>(
  options: CreateEventStreamOptions<TEvent>,
): EventStreamHandle {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    return {
      close() {
        return;
      },
    };
  }

  const source = new EventSource(buildEventsUrl(options.baseUrl, options.path, options.accessToken));

  const handleMessage = (message: MessageEvent<string>) => {
    try {
      const event = JSON.parse(message.data) as TEvent;
      options.onEvent(event);
    } catch (err) {
      console.warn("sse: malformed event payload", err);
    }
  };
  source.onmessage = handleMessage;
  options.eventTypes.forEach((eventType) => {
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

export const SESSION_EVENT_TYPES = [
  "session.snapshot",
  "session.created",
  "session.resumed",
  "session.stale",
  "session.abandoned",
  "session.interrupted",
  "scan.started",
  "scan.progress",
  "scan.completed",
  "plan.updated",
  "precheck.ready",
  "execution.started",
  "execution.completed",
  "rollback.started",
  "rollback.completed",
  "cleanup.completed",
  "session.error",
  "scan.action",
  "scan.ai_typing",
  "plan.action",
  "plan.ai_typing",
] as const;

export interface SessionEventStream {
  close(): void;
}

export interface CreateSessionEventStreamOptions {
  baseUrl: string;
  sessionId: string;
  accessToken?: string;
  onEvent: (event: SessionEvent) => void;
  onError?: (error: Event) => void;
}

export function createSessionEventStream(
  options: CreateSessionEventStreamOptions,
): SessionEventStream {
  return createEventStream<SessionEvent>({
    baseUrl: options.baseUrl,
    path: `/api/sessions/${options.sessionId}/events`,
    accessToken: options.accessToken,
    eventTypes: SESSION_EVENT_TYPES,
    onEvent: options.onEvent,
    onError: options.onError,
  });
}
