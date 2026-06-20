// Dashboard HTTP dispatch: /api/* -> JSON handlers, everything else -> the SPA.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Queue } from "../index";
import { WebhookValidationError } from "../webhooks";
import { routes } from "./routes";
import { StaticAssets } from "./static";

/** Max request body size (1 MiB) — reject larger payloads to bound memory. */
const MAX_BODY_BYTES = 1024 * 1024;

/** Build (but do not start) the dashboard server over `queue`, serving the SPA from `staticDir`. */
export function createDashboardServer(queue: Queue, staticDir: string): Server {
  const assets = new StaticAssets(staticDir);
  return createServer((req, res) => {
    void dispatch(queue, assets, req, res).catch((error) => {
      console.error("[taskito] dashboard dispatch failed:", error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal server error" });
      }
    });
  });
}

async function dispatch(
  queue: Queue,
  assets: StaticAssets,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (!path.startsWith("/api/")) {
    if (assets.serve(path, res)) {
      return;
    }
    sendJson(res, 503, { error: "dashboard assets not built — run `pnpm build:dashboard`" });
    return;
  }

  for (const route of routes) {
    if (route.method !== req.method) {
      continue;
    }
    const match = path.match(route.pattern);
    if (!match) {
      continue;
    }
    const params = match.slice(1).map((value) => decodeURIComponent(value ?? ""));
    const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : undefined;
    try {
      const result = await route.handle(queue, url, params, body);
      if (result === undefined) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      if (path === "/api/auth/whoami") {
        setAuthCookies(res);
      }
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof WebhookValidationError) {
        sendJson(res, 400, { error: error.message });
        return;
      }
      // Log internally but never leak error/stack details to the HTTP client.
      console.error("[taskito] dashboard request failed:", error);
      sendJson(res, 500, { error: "internal server error" });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

/** Read and JSON-parse a request body (undefined when empty, invalid, or oversized).
 * Caps total size at {@link MAX_BODY_BYTES} and resolves on stream error/abort. */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    const finish = (value: unknown) => {
      if (!aborted) {
        aborted = true;
        resolve(value);
      }
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        finish(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        finish(undefined);
        return;
      }
      try {
        // Decode once over the joined buffer so multi-byte UTF-8 split across
        // chunk boundaries isn't corrupted into replacement characters.
        finish(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        finish(undefined);
      }
    });
    req.on("error", () => finish(undefined));
    req.on("aborted", () => finish(undefined));
  });
}

/** Open-mode session/CSRF cookies so the SPA proceeds without a login. */
function setAuthCookies(res: ServerResponse): void {
  res.setHeader("set-cookie", [
    "taskito_session=open; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400",
    "taskito_csrf=open; SameSite=Strict; Path=/; Max-Age=86400",
  ]);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
