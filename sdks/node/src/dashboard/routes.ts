import type { Queue } from "../index";
import * as h from "./handlers";

export interface Route {
  method: string;
  pattern: RegExp;
  handle: (queue: Queue, url: URL, params: string[], body: unknown) => unknown | Promise<unknown>;
}

const id = (params: string[]): string => params[0] ?? "";

/** Route table, walked in order: exact paths first, then parameterized ones. */
export const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/auth\/status$/, handle: () => h.authStatus() },
  { method: "GET", pattern: /^\/api\/auth\/whoami$/, handle: () => h.whoami() },
  { method: "GET", pattern: /^\/api\/stats$/, handle: (q) => h.stats(q) },
  { method: "GET", pattern: /^\/api\/stats\/queues$/, handle: (q, url) => h.statsQueues(q, url) },
  { method: "GET", pattern: /^\/api\/queues\/paused$/, handle: (q) => h.queuesPaused(q) },
  { method: "GET", pattern: /^\/api\/jobs$/, handle: (q, url) => h.jobs(q, url) },
  { method: "GET", pattern: /^\/api\/jobs\/([^/]+)$/, handle: (q, _url, p) => h.job(q, id(p)) },
  { method: "GET", pattern: /^\/api\/dead-letters$/, handle: (q, url) => h.deadLetters(q, url) },
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
    handle: (q, _url, p) => h.webhookDeliveries(q, id(p)),
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
