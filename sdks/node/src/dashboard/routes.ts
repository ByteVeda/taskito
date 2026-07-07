import type { Queue } from "../index";
import * as auth from "./authHandlers";
import * as h from "./handlers";
import * as middleware from "./middlewareHandlers";
import * as ops from "./opsHandlers";
import * as overrides from "./overridesHandlers";
import type { RequestContext } from "./requestContext";
import * as settings from "./settingsHandlers";

export interface Route {
  method: string;
  pattern: RegExp;
  handle: (
    queue: Queue,
    url: URL,
    params: string[],
    body: unknown,
    ctx: RequestContext,
  ) => unknown | Promise<unknown>;
}

// ── Auth policy ─────────────────────────────────────────────────────────

/** Exact paths that bypass the session/CSRF gate. */
export const PUBLIC_PATHS = new Set([
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/setup",
  "/api/auth/providers",
  "/health",
  "/readiness",
  "/metrics",
]);

/** Prefixes that bypass auth — OAuth paths carry a provider slot in the URL. */
export const PUBLIC_PATH_PREFIXES = ["/api/auth/oauth/start/", "/api/auth/oauth/callback/"];

/** State-changing paths a non-admin may call on their own session. */
const SELF_SERVICE_PATHS = new Set(["/api/auth/logout", "/api/auth/change-password"]);

/** Paths exempt from CSRF because no session exists yet. */
const CSRF_EXEMPT_PATHS = new Set(["/api/auth/login", "/api/auth/setup"]);

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path) || PUBLIC_PATH_PREFIXES.some((p) => path.startsWith(p));
}

export function isStateChangingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH";
}

export function isCsrfExempt(path: string): boolean {
  return CSRF_EXEMPT_PATHS.has(path);
}

export function requiresAdmin(path: string, method: string): boolean {
  return isStateChangingMethod(method) && !SELF_SERVICE_PATHS.has(path);
}

const id = (params: string[]): string => params[0] ?? "";

/** Route table, walked in order: exact paths first, then parameterized ones. */
export const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/auth\/status$/, handle: (q) => auth.authStatus(q) },
  {
    method: "GET",
    pattern: /^\/api\/auth\/whoami$/,
    handle: (q, _u, _p, _b, c) => auth.whoami(q, c),
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/setup$/,
    handle: (q, _u, _p, body) => auth.setup(q, body),
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/login$/,
    handle: (q, _u, _p, body) => auth.login(q, body),
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/logout$/,
    handle: (q, _u, _p, _b, c) => auth.logout(q, c),
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/change-password$/,
    handle: (q, _u, _p, body, c) => auth.changePassword(q, body, c),
  },
  { method: "GET", pattern: /^\/api\/auth\/providers$/, handle: () => h.authProviders() },
  { method: "GET", pattern: /^\/api\/stats$/, handle: (q) => h.stats(q) },
  { method: "GET", pattern: /^\/api\/stats\/queues$/, handle: (q, url) => h.statsQueues(q, url) },
  { method: "GET", pattern: /^\/api\/queues\/paused$/, handle: (q) => h.queuesPaused(q) },
  { method: "GET", pattern: /^\/api\/jobs$/, handle: (q, url) => h.jobs(q, url) },
  {
    method: "GET",
    pattern: /^\/api\/jobs\/([^/]+)\/errors$/,
    handle: (q, _url, p) => h.jobErrors(q, id(p)),
  },
  {
    method: "GET",
    pattern: /^\/api\/jobs\/([^/]+)\/logs$/,
    handle: (q, _url, p) => h.jobLogs(q, id(p)),
  },
  { method: "GET", pattern: /^\/api\/jobs\/([^/]+)$/, handle: (q, _url, p) => h.job(q, id(p)) },
  { method: "GET", pattern: /^\/api\/dead-letters$/, handle: (q, url) => h.deadLetters(q, url) },
  {
    method: "POST",
    pattern: /^\/api\/dead-letters\/purge$/,
    handle: (q) => h.purgeDeadLetters(q),
  },
  { method: "GET", pattern: /^\/api\/settings$/, handle: (q) => settings.listSettings(q) },
  {
    method: "GET",
    pattern: /^\/api\/settings\/(.+)$/,
    handle: (q, _url, p) => settings.getSetting(q, id(p)),
  },
  {
    method: "PUT",
    pattern: /^\/api\/settings\/(.+)$/,
    handle: (q, _url, p, body) => settings.putSetting(q, id(p), body),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/settings\/(.+)$/,
    handle: (q, _url, p) => settings.deleteSetting(q, id(p)),
  },
  { method: "GET", pattern: /^\/api\/scaler$/, handle: (q, url) => ops.scaler(q, url) },
  { method: "GET", pattern: /^\/api\/resources$/, handle: (q) => ops.resourceStatus(q) },
  { method: "GET", pattern: /^\/api\/tasks$/, handle: (q) => overrides.listTasks(q) },
  { method: "GET", pattern: /^\/api\/queues$/, handle: (q) => overrides.listQueues(q) },
  {
    method: "GET",
    pattern: /^\/api\/tasks\/([^/]+)\/override$/,
    handle: (q, _url, p) => overrides.getTaskOverride(q, id(p)),
  },
  {
    method: "PUT",
    pattern: /^\/api\/tasks\/([^/]+)\/override$/,
    handle: (q, _url, p, body) => overrides.putTaskOverride(q, id(p), body),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/tasks\/([^/]+)\/override$/,
    handle: (q, _url, p) => overrides.deleteTaskOverride(q, id(p)),
  },
  {
    method: "GET",
    pattern: /^\/api\/queues\/([^/]+)\/override$/,
    handle: (q, _url, p) => overrides.getQueueOverride(q, id(p)),
  },
  {
    method: "PUT",
    pattern: /^\/api\/queues\/([^/]+)\/override$/,
    handle: (q, _url, p, body) => overrides.putQueueOverride(q, id(p), body),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/queues\/([^/]+)\/override$/,
    handle: (q, _url, p) => overrides.deleteQueueOverride(q, id(p)),
  },
  { method: "GET", pattern: /^\/api\/middleware$/, handle: (q) => middleware.listMiddleware(q) },
  {
    method: "GET",
    pattern: /^\/api\/tasks\/([^/]+)\/middleware$/,
    handle: (q, _url, p) => middleware.getTaskMiddleware(q, id(p)),
  },
  {
    method: "PUT",
    pattern: /^\/api\/tasks\/([^/]+)\/middleware\/([^/]+)$/,
    handle: (q, _url, p, body) => middleware.putTaskMiddleware(q, id(p), p[1] ?? "", body),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/tasks\/([^/]+)\/middleware$/,
    handle: (q, _url, p) => middleware.deleteTaskMiddleware(q, id(p)),
  },
  { method: "GET", pattern: /^\/api\/metrics$/, handle: (q, url) => h.metrics(q, url) },
  {
    method: "GET",
    pattern: /^\/api\/metrics\/timeseries$/,
    handle: (q, url) => h.timeseries(q, url),
  },
  { method: "GET", pattern: /^\/api\/workers$/, handle: (q) => h.workers(q) },
  {
    method: "POST",
    pattern: /^\/api\/jobs\/([^/]+)\/cancel$/,
    handle: (q, _url, p) => h.cancel(q, id(p)),
  },
  {
    method: "POST",
    pattern: /^\/api\/dead-letters\/([^/]+)\/retry$/,
    handle: (q, _url, p) => h.retryDead(q, id(p)),
  },
  {
    method: "POST",
    pattern: /^\/api\/queues\/([^/]+)\/pause$/,
    handle: (q, _url, p) => h.pause(q, id(p)),
  },
  {
    method: "POST",
    pattern: /^\/api\/queues\/([^/]+)\/resume$/,
    handle: (q, _url, p) => h.resume(q, id(p)),
  },
  { method: "GET", pattern: /^\/api\/event-types$/, handle: (q) => h.eventTypes(q) },
  {
    method: "GET",
    pattern: /^\/api\/workflows\/runs$/,
    handle: (q, url) => h.workflowRuns(q, url),
  },
  {
    method: "GET",
    pattern: /^\/api\/workflows\/runs\/([^/]+)\/dag$/,
    handle: (q, _url, p) => h.workflowDag(q, id(p)),
  },
  {
    method: "GET",
    pattern: /^\/api\/workflows\/runs\/([^/]+)\/children$/,
    handle: (q, _url, p) => h.workflowChildren(q, id(p)),
  },
  {
    method: "GET",
    pattern: /^\/api\/workflows\/runs\/([^/]+)$/,
    handle: (q, _url, p) => h.workflowRun(q, id(p)),
  },
  { method: "GET", pattern: /^\/api\/webhooks$/, handle: (q) => h.webhooks(q) },
  {
    method: "POST",
    pattern: /^\/api\/webhooks$/,
    handle: (q, _url, _p, body) => h.createWebhook(q, body),
  },
  {
    method: "POST",
    pattern: /^\/api\/webhooks\/([^/]+)\/test$/,
    handle: (q, _url, p) => h.testWebhook(q, id(p)),
  },
  {
    method: "GET",
    pattern: /^\/api\/webhooks\/([^/]+)\/deliveries$/,
    handle: (q, url, p) => h.webhookDeliveries(q, id(p), url),
  },
  {
    method: "GET",
    pattern: /^\/api\/webhooks\/([^/]+)\/deliveries\/([^/]+)$/,
    handle: (q, _url, p) => h.webhookDelivery(q, id(p), p[1] ?? ""),
  },
  {
    method: "POST",
    pattern: /^\/api\/webhooks\/([^/]+)\/deliveries\/([^/]+)\/replay$/,
    handle: (q, _url, p) => h.replayWebhookDelivery(q, id(p), p[1] ?? ""),
  },
  {
    method: "POST",
    pattern: /^\/api\/webhooks\/([^/]+)\/rotate-secret$/,
    handle: (q, _url, p) => h.rotateWebhookSecret(q, id(p)),
  },
  {
    method: "GET",
    pattern: /^\/api\/webhooks\/([^/]+)$/,
    handle: (q, _url, p) => h.webhook(q, id(p)),
  },
  {
    method: "PUT",
    pattern: /^\/api\/webhooks\/([^/]+)$/,
    handle: (q, _url, p, body) => h.updateWebhook(q, id(p), body),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/webhooks\/([^/]+)$/,
    handle: (q, _url, p) => h.deleteWebhook(q, id(p)),
  },
];
