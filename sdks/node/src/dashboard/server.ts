// Dashboard HTTP dispatch: /api/* -> JSON handlers, everything else -> the SPA.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Queue } from "../index";
import { routes } from "./routes";
import { StaticAssets } from "./static";

/** Build (but do not start) the dashboard server over `queue`, serving the SPA from `staticDir`. */
export function createDashboardServer(queue: Queue, staticDir: string): Server {
  const assets = new StaticAssets(staticDir);
  return createServer((req, res) => dispatch(queue, assets, req, res));
}

function dispatch(
  queue: Queue,
  assets: StaticAssets,
  req: IncomingMessage,
  res: ServerResponse,
): void {
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
    try {
      const body = route.handle(queue, url, params);
      if (body === undefined) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      if (path === "/api/auth/whoami") {
        setAuthCookies(res);
      }
      sendJson(res, 200, body);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
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
