import { createEventStream } from "@/lib/sse";
import type { IconWorkbenchEvent } from "@/types/icon-workbench";

export const ICON_WORKBENCH_EVENT_TYPES = [
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
] as const;

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
  return createEventStream<IconWorkbenchEvent>({
    baseUrl: options.baseUrl,
    path: `/api/icon-workbench/sessions/${options.sessionId}/events`,
    accessToken: options.accessToken,
    eventTypes: ICON_WORKBENCH_EVENT_TYPES,
    onEvent: options.onEvent,
    onError: options.onError,
  });
}
