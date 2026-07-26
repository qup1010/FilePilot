import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAuthHeaders, joinUrl, requestJson } from "./http";
import { UserFacingError } from "./user-facing-copy";

vi.mock("@/lib/runtime", () => ({
  waitForRuntimeConfig: vi.fn(),
}));

import { waitForRuntimeConfig } from "@/lib/runtime";

const waitForRuntimeConfigMock = vi.mocked(waitForRuntimeConfig);
const fetchMock = vi.fn();

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(text: string, init: { status: number; statusText?: string }) {
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    statusText: init.statusText ?? "",
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  waitForRuntimeConfigMock.mockResolvedValue({ base_url: "", api_token: "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("joinUrl", () => {
  it("joins a base without trailing slash and a path with leading slash", () => {
    expect(joinUrl("http://127.0.0.1:8765", "/api/sessions")).toBe("http://127.0.0.1:8765/api/sessions");
  });

  it("collapses a trailing slash on the base url", () => {
    expect(joinUrl("http://127.0.0.1:8765/", "/api/sessions")).toBe("http://127.0.0.1:8765/api/sessions");
  });

  it("accepts paths without a leading slash", () => {
    expect(joinUrl("http://127.0.0.1:8765", "api/sessions")).toBe("http://127.0.0.1:8765/api/sessions");
  });

  it("preserves a path prefix on the base url", () => {
    expect(joinUrl("http://127.0.0.1:8765/prefix", "/api/sessions")).toBe(
      "http://127.0.0.1:8765/prefix/api/sessions",
    );
  });

  it("returns the base url for an empty path", () => {
    expect(joinUrl("http://127.0.0.1:8765", "")).toBe("http://127.0.0.1:8765/");
  });
});

describe("buildAuthHeaders", () => {
  it("adds a bearer authorization header when a token is provided", () => {
    const headers = buildAuthHeaders("secret-token");
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });

  it("omits the authorization header without a token", () => {
    expect(buildAuthHeaders(undefined).has("Authorization")).toBe(false);
    expect(buildAuthHeaders("").has("Authorization")).toBe(false);
  });

  it("preserves existing headers while adding authorization", () => {
    const headers = buildAuthHeaders("secret-token", { "Content-Type": "application/json" });
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });
});

describe("requestJson", () => {
  it("fetches the joined url and parses the JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ hello: "world" }));

    const result = await requestJson<{ hello: string }>("http://127.0.0.1:8765/", "/api/demo");

    expect(result).toEqual({ hello: "world" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8765/api/demo");
    expect((init.headers as Headers).has("Authorization")).toBe(false);
  });

  it("sends the bearer token from the caller when the runtime has none", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await requestJson("http://127.0.0.1:8765", "/api/demo", {}, "fallback-token");

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer fallback-token");
  });

  it("prefers the runtime base url and token over the caller values", async () => {
    waitForRuntimeConfigMock.mockResolvedValue({
      base_url: "http://10.0.0.2:9000",
      api_token: "runtime-token",
    });
    fetchMock.mockResolvedValue(jsonResponse({}));

    await requestJson("http://127.0.0.1:8765", "/api/demo", {}, "fallback-token");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://10.0.0.2:9000/api/demo");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer runtime-token");
  });

  it("keeps request init options such as method and body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await requestJson("http://127.0.0.1:8765", "/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
  });

  it("throws a UserFacingError with a Chinese message on 404", async () => {
    fetchMock.mockResolvedValue(textResponse("", { status: 404, statusText: "Not Found" }));

    const error = await requestJson("http://127.0.0.1:8765", "/api/demo").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(UserFacingError);
    const facing = error as UserFacingError;
    expect(facing.message).toBe("这条任务记录已不存在或已被删除。");
    expect(facing.status).toBe(404);
  });

  it("maps a known error detail to its Chinese copy and keeps the raw payload", async () => {
    fetchMock.mockResolvedValue(
      textResponse(JSON.stringify({ detail: "SESSION_LOCKED" }), { status: 409, statusText: "Conflict" }),
    );

    const error = await requestJson("http://127.0.0.1:8765", "/api/demo").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(UserFacingError);
    const facing = error as UserFacingError;
    expect(facing.message).toBe("当前任务正在被其他操作占用，请稍后再试。");
    expect(facing.code).toBe("SESSION_LOCKED");
    expect(facing.status).toBe(409);
    expect(facing.rawMessage).toContain("SESSION_LOCKED");
  });

  it("throws a generic Chinese message for server errors", async () => {
    fetchMock.mockResolvedValue(textResponse("boom", { status: 500, statusText: "Internal Server Error" }));

    const error = await requestJson("http://127.0.0.1:8765", "/api/demo").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).message).toBe("本地服务处理请求时出错，请稍后再试。");
  });
});
