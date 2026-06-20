import type { Queue } from "../index";
import * as h from "./handlers";

export interface Route {
  method: string;
  pattern: RegExp;
  handle: (queue: Queue, url: URL, params: string[]) => unknown;
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
  { method: "GET", pattern: /^\/api\/workers$/, handle: () => h.workers() },
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
];
