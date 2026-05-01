import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

describe("api.get URL building", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hits the path verbatim when no params", async () => {
    await api.get("/api/jobs");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/jobs",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("encodes params and skips null/undefined/empty-string", async () => {
    await api.get("/api/jobs", {
      params: {
        status: "running",
        limit: 25,
        bool: true,
        skipNull: null,
        skipUndefined: undefined,
        skipEmpty: "",
      },
    });
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(url).toBe("/api/jobs?status=running&limit=25&bool=true");
  });

  it("escapes special characters in query values", async () => {
    await api.get("/api/jobs", { params: { task: "send email & sms" } });
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(url).toBe("/api/jobs?task=send+email+%26+sms");
  });

  it("forwards Accept and custom headers", async () => {
    await api.get("/api/jobs", { headers: { "X-Trace": "abc" } });
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(init?.headers).toMatchObject({ Accept: "application/json", "X-Trace": "abc" });
  });

  it("passes the abort signal through", async () => {
    const controller = new AbortController();
    await api.get("/api/jobs", { signal: controller.signal });
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(init?.signal).toBe(controller.signal);
  });
});

describe("api response parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses JSON when content-type is application/json", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ items: [1, 2] }));
    const result = await api.get<{ items: number[] }>("/api/x");
    expect(result).toEqual({ items: [1, 2] });
  });

  it("falls back to text when content-type is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("hello"));
    const result = await api.get<string>("/api/x");
    expect(result).toBe("hello");
  });

  it("throws ApiError with structured message on non-OK JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "queue not found" }, 404),
    );
    await expect(api.get("/api/missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "queue not found",
      body: { error: "queue not found" },
    });
  });

  it("throws ApiError with status fallback when JSON has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ note: "oops" }, 500));
    await expect(api.get("/api/x")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      message: "Request failed with status 500",
    });
  });

  it("throws ApiError on non-OK text response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("bad gateway", 502));
    await expect(api.get("/api/x")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      message: "Request failed with status 502",
      body: "bad gateway",
    });
  });
});

describe("api write methods", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("post serializes JSON body and sets content-type", async () => {
    await api.post("/api/jobs", { task: "send_email" });
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ task: "send_email" }));
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("post omits body and content-type when body is undefined", async () => {
    await api.post("/api/queues/default/pause");
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(init?.body).toBeUndefined();
    expect(init?.headers).not.toHaveProperty("Content-Type");
  });

  it("put sends PUT method", async () => {
    await api.put("/api/settings", { theme: "dark" });
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(init?.method).toBe("PUT");
  });

  it("delete sends DELETE method", async () => {
    await api.delete("/api/jobs/abc");
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(init?.method).toBe("DELETE");
  });
});

describe("ApiError", () => {
  it("preserves message, status, and body", () => {
    const err = new ApiError("nope", 418, { teapot: true });
    expect(err.message).toBe("nope");
    expect(err.status).toBe(418);
    expect(err.body).toEqual({ teapot: true });
    expect(err).toBeInstanceOf(Error);
  });
});
