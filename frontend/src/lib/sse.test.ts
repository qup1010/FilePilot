import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createIconWorkbenchEventStream, ICON_WORKBENCH_EVENT_TYPES } from "./icon-workbench-sse";
import { createEventStream, createSessionEventStream, SESSION_EVENT_TYPES } from "./sse";

type MessageHandler = (event: MessageEvent<string>) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  closed = false;
  onmessage: MessageHandler | null = null;
  onerror: ((event: Event) => void) | null = null;
  listeners = new Map<string, MessageHandler[]>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: MessageHandler): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    const message = { data } as MessageEvent<string>;
    (this.listeners.get(type) ?? []).forEach((handler) => handler(message));
  }

  emitMessage(data: string): void {
    this.onmessage?.({ data } as MessageEvent<string>);
  }

  emitError(): void {
    this.onerror?.(new Event("error"));
  }
}

function latestSource(): MockEventSource {
  const source = MockEventSource.instances.at(-1);
  if (!source) {
    throw new Error("no EventSource instance was created");
  }
  return source;
}

const originalEventSource = window.EventSource;

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  window.EventSource = MockEventSource as unknown as typeof EventSource;
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.EventSource = originalEventSource;
  vi.restoreAllMocks();
});

describe("createEventStream", () => {
  const baseOptions = {
    baseUrl: "http://127.0.0.1:8765",
    path: "/api/sessions/session-1/events",
    eventTypes: ["scan.started", "scan.completed"] as const,
  };

  it("builds the stream url from base url, path and access token", () => {
    createEventStream({
      ...baseOptions,
      accessToken: "token-1",
      onEvent: () => undefined,
    });

    expect(latestSource().url).toBe(
      "http://127.0.0.1:8765/api/sessions/session-1/events?access_token=token-1",
    );
  });

  it("omits the access token query when none is provided", () => {
    createEventStream({ ...baseOptions, onEvent: () => undefined });

    expect(latestSource().url).toBe("http://127.0.0.1:8765/api/sessions/session-1/events");
  });

  it("registers a listener per event type and a default message handler", () => {
    createEventStream({ ...baseOptions, onEvent: () => undefined });

    const source = latestSource();
    expect([...source.listeners.keys()]).toEqual(["scan.started", "scan.completed"]);
    expect(source.onmessage).toBeTypeOf("function");
  });

  it("dispatches parsed payloads from typed events and default messages to onEvent", () => {
    const onEvent = vi.fn();
    createEventStream<{ type: string }>({ ...baseOptions, onEvent });

    const source = latestSource();
    source.emit("scan.started", JSON.stringify({ type: "scan.started" }));
    source.emitMessage(JSON.stringify({ type: "session.snapshot" }));

    expect(onEvent).toHaveBeenNthCalledWith(1, { type: "scan.started" });
    expect(onEvent).toHaveBeenNthCalledWith(2, { type: "session.snapshot" });
  });

  it("invokes onError when the source errors", () => {
    const onError = vi.fn();
    createEventStream({ ...baseOptions, onEvent: () => undefined, onError });

    latestSource().emitError();

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("close() closes the underlying source", () => {
    const stream = createEventStream({ ...baseOptions, onEvent: () => undefined });

    stream.close();

    expect(latestSource().closed).toBe(true);
  });

  it("warns instead of throwing on malformed JSON payloads", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onEvent = vi.fn();
    createEventStream({ ...baseOptions, onEvent });

    expect(() => latestSource().emit("scan.started", "{not json")).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("sse: malformed event payload", expect.anything());
  });
});

describe("createSessionEventStream", () => {
  it("streams from the session events path with all session event types", () => {
    const onEvent = vi.fn();
    const stream = createSessionEventStream({
      baseUrl: "http://127.0.0.1:8765/",
      sessionId: "session-42",
      onEvent,
    });

    const source = latestSource();
    expect(source.url).toBe("http://127.0.0.1:8765/api/sessions/session-42/events");
    expect([...source.listeners.keys()]).toEqual([...SESSION_EVENT_TYPES]);
    expect(SESSION_EVENT_TYPES).toHaveLength(21);

    source.emit("plan.updated", JSON.stringify({ type: "plan.updated" }));
    expect(onEvent).toHaveBeenCalledWith({ type: "plan.updated" });

    stream.close();
    expect(source.closed).toBe(true);
  });
});

describe("createIconWorkbenchEventStream", () => {
  it("streams from the icon workbench events path with all icon event types", () => {
    const onEvent = vi.fn();
    createIconWorkbenchEventStream({
      baseUrl: "http://127.0.0.1:8765",
      sessionId: "icon-7",
      accessToken: "tok",
      onEvent,
    });

    const source = latestSource();
    expect(source.url).toBe(
      "http://127.0.0.1:8765/api/icon-workbench/sessions/icon-7/events?access_token=tok",
    );
    expect([...source.listeners.keys()]).toEqual([...ICON_WORKBENCH_EVENT_TYPES]);
    expect(ICON_WORKBENCH_EVENT_TYPES).toHaveLength(10);

    source.emit("icon.generation.completed", JSON.stringify({ type: "icon.generation.completed" }));
    expect(onEvent).toHaveBeenCalledWith({ type: "icon.generation.completed" });
  });
});
