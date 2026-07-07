// Dashboard HTTP dispatch: /api/* -> JSON handlers, everything else -> the SPA.
//
// Two auth modes:
// - Session mode (default): full login flow — first-run setup, password
//   sessions, CSRF double-submit, and admin/viewer roles, all persisted in
//   the queue's settings store.
// - Token mode (legacy, `auth: {token}`): a single shared token gates the
//   API; the SPA gets a fixed identity once past the token check.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Queue } from "../index";
import { createLogger } from "../utils";
import { WebhookValidationError } from "../webhooks";
import {
  type DashboardAuth,
  isPublicApiPath,
  presentedToken,
  setTokenCookie,
  tokenMatches,
} from "./auth";
import { AuthStore } from "./authStore";
import { DashboardError } from "./errors";
import { openAuthStatus, openWhoami } from "./handlers";
import {
  buildContext,
  CSRF_COOKIE,
  csrfValid,
  type RequestContext,
  SESSION_COOKIE,
} from "./requestContext";
import { isCsrfExempt, isPublicPath, isStateChangingMethod, requiresAdmin, routes } from "./routes";
import { StaticAssets } from "./static";

const log = createLogger("dashboard");

/** Max request body size (1 MiB) — reject larger payloads to bound memory. */
const MAX_BODY_BYTES = 1024 * 1024;

/** Options accepted by {@link createDashboardHandler} / {@link createDashboardServer}. */
export interface DashboardHandlerOptions {
  /** Legacy shared-token gate. When set, the session-auth flow is disabled. */
  auth?: DashboardAuth;
  /** Mark session cookies `Secure` (default true). Disable only for plain-HTTP dev. */
  secureCookies?: boolean;
}

/** Accept the pre-options `DashboardAuth` third argument for compatibility. */
function normalizeOptions(
  options?: DashboardHandlerOptions | DashboardAuth,
): DashboardHandlerOptions {
  if (options && "token" in options && typeof options.token === "string") {
    return { auth: options };
  }
  return (options as DashboardHandlerOptions | undefined) ?? {};
}

/**
 * Build a Node `http` request handler that serves the dashboard SPA from `staticDir`
 * plus the `/api/*` JSON contract over `queue`. Use this to mount the dashboard into an
 * existing server (e.g. an Express or Fastify app); {@link createDashboardServer} wraps
 * it in a standalone server.
 */
export function createDashboardHandler(
  queue: Queue,
  staticDir: string,
  options?: DashboardHandlerOptions | DashboardAuth,
): (req: IncomingMessage, res: ServerResponse) => void {
  const assets = new StaticAssets(staticDir);
  const resolved = normalizeOptions(options);
  return (req, res) => {
    void dispatch(queue, assets, req, res, resolved).catch((error) => {
      log.error(() => "dashboard dispatch failed", error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal server error" });
      }
    });
  };
}

/** Build (but do not start) the dashboard server over `queue`, serving the SPA from `staticDir`. */
export function createDashboardServer(
  queue: Queue,
  staticDir: string,
  options?: DashboardHandlerOptions | DashboardAuth,
): Server {
  return createServer(createDashboardHandler(queue, staticDir, options));
}

async function dispatch(
  queue: Queue,
  assets: StaticAssets,
  req: IncomingMessage,
  res: ServerResponse,
  options: DashboardHandlerOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const auth = options.auth;

  // Token mode: a valid `?token=` bootstraps an httpOnly cookie so the SPA's
  // later API calls authenticate without re-passing the token.
  if (auth && url.searchParams.get("token") && tokenMatches(auth.token, presentedToken(req, url))) {
    setTokenCookie(res, auth.token);
  }

  if (!path.startsWith("/api/")) {
    if (assets.serve(path, res)) {
      return;
    }
    sendJson(res, 503, { error: "dashboard assets not built — run `pnpm build:dashboard`" });
    return;
  }

  if (auth) {
    await dispatchTokenMode(queue, req, res, url, path, auth);
    return;
  }

  const store = new AuthStore(queue);
  const ctx = buildContext(req, (token) => store.getSession(token));
  const denied = authorize(store, ctx, path, req.method ?? "GET");
  if (denied) {
    sendJson(res, denied.status, { error: denied.code });
    return;
  }
  await runRoute(queue, req, res, url, path, ctx, options.secureCookies !== false);
}

/** The session/CSRF/role gate. Returns the denial, or undefined to proceed. */
function authorize(
  store: AuthStore,
  ctx: RequestContext,
  path: string,
  method: string,
): { status: number; code: string } | undefined {
  if (isPublicPath(path)) {
    return undefined;
  }
  if (store.countUsers() === 0) {
    return { status: 503, code: "setup_required" };
  }
  if (!ctx.session) {
    return { status: 401, code: "not_authenticated" };
  }
  if (isStateChangingMethod(method) && !isCsrfExempt(path) && !csrfValid(ctx)) {
    return { status: 403, code: "csrf_failed" };
  }
  if (requiresAdmin(path, method) && ctx.session.role !== "admin") {
    return { status: 403, code: "forbidden" };
  }
  return undefined;
}

async function runRoute(
  queue: Queue,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  ctx: RequestContext,
  secureCookies: boolean,
): Promise<void> {
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
      const result = await route.handle(queue, url, params, body, ctx);
      if (result === undefined) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, applyAuthCookies(res, path, result, secureCookies));
    } catch (error) {
      if (error instanceof DashboardError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      if (error instanceof WebhookValidationError) {
        sendJson(res, 400, { error: error.message });
        return;
      }
      // Log internally but never leak error/stack details to the HTTP client.
      log.error(() => `${req.method} ${path} failed`, error);
      sendJson(res, 500, { error: "internal server error" });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

/**
 * Cookie side effects for auth flows: a successful login sets the session +
 * CSRF cookies (and the raw token is redacted from the JSON body); logout
 * clears them.
 */
function applyAuthCookies(
  res: ServerResponse,
  path: string,
  result: unknown,
  secure: boolean,
): unknown {
  if (path === "/api/auth/logout") {
    res.setHeader("set-cookie", clearSessionCookies(secure));
    return result;
  }
  if (path !== "/api/auth/login") {
    return result;
  }
  const login = result as {
    session?: { token?: string; csrf_token?: string; expires_at?: number };
  };
  const session = login.session;
  if (!session?.token || !session.csrf_token) {
    return result;
  }
  const ttl = Math.max(0, (session.expires_at ?? 0) - Math.floor(Date.now() / 1000));
  res.setHeader("set-cookie", sessionCookies(session.token, session.csrf_token, ttl, secure));
  const { token: _redacted, ...rest } = session;
  return { ...login, session: rest };
}

function sessionCookies(token: string, csrf: string, ttl: number, secure: boolean): string[] {
  const attrs = `SameSite=Strict; Path=/; Max-Age=${ttl}${secure ? "; Secure" : ""}`;
  return [`${SESSION_COOKIE}=${token}; HttpOnly; ${attrs}`, `${CSRF_COOKIE}=${csrf}; ${attrs}`];
}

function clearSessionCookies(secure: boolean): string[] {
  const attrs = `SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
  return [`${SESSION_COOKIE}=; HttpOnly; ${attrs}`, `${CSRF_COOKIE}=; ${attrs}`];
}

/** Legacy shared-token dispatch: stub auth boot endpoints + token-gated API. */
async function dispatchTokenMode(
  queue: Queue,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  auth: DashboardAuth,
): Promise<void> {
  if (!isPublicApiPath(path) && !tokenMatches(auth.token, presentedToken(req, url))) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (path.startsWith("/api/auth/")) {
    if (path === "/api/auth/status") {
      sendJson(res, 200, openAuthStatus());
    } else if (path === "/api/auth/whoami") {
      setOpenAuthCookies(res);
      sendJson(res, 200, openWhoami());
    } else {
      sendJson(res, 404, { error: "not found" });
    }
    return;
  }
  const openCtx: RequestContext = {
    session: undefined,
    csrfCookie: undefined,
    csrfHeader: undefined,
  };
  await runRoute(queue, req, res, url, path, openCtx, true);
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

/** Token-mode session/CSRF cookies so the SPA proceeds without a login. */
function setOpenAuthCookies(res: ServerResponse): void {
  res.setHeader("set-cookie", [
    "taskito_session=open; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400",
    "taskito_csrf=open; SameSite=Strict; Path=/; Max-Age=86400",
  ]);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
