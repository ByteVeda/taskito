// JSON API handlers over a Queue, returning the SPA's snake_case contract.
// `undefined` from a handler means 404.

import { randomBytes } from "node:crypto";
import type { EventName } from "../events";
import type { Queue } from "../index";
import type { WebhookInput } from "../webhooks";
import type { WorkflowNode } from "../workflows";
import {
  deadToContract,
  deliveryToContract,
  jobToContract,
  webhookToContract,
  workerToContract,
  workflowNodeToContract,
  workflowRunToContract,
} from "./contract";
import { aggregateByTask, bucketTimeseries } from "./metrics";

/** Finite, non-negative number from a query string, or `undefined`. */
function num(url: URL, key: string): number | undefined {
  return toNonNegative(url.searchParams.get(key));
}

function toNonNegative(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Positive number from a query string, falling back to `fallback` when invalid. */
function positiveOr(value: string | null, fallback: number): number {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function stats(queue: Queue) {
  return queue.stats();
}

export async function statsQueues(queue: Queue, url: URL) {
  const name = url.searchParams.get("queue");
  return name ? { [name]: await queue.statsByQueue(name) } : queue.statsAllQueues();
}

export function queuesPaused(queue: Queue) {
  return queue.listPausedQueues();
}

export async function jobs(queue: Queue, url: URL) {
  const sp = url.searchParams;
  const page = sp.get("page");
  const pageSize = sp.get("pageSize");
  const limit = sp.get("limit") ?? pageSize ?? undefined;
  const offset =
    sp.get("offset") ??
    (page !== null && pageSize !== null ? String(Number(page) * Number(pageSize)) : undefined);
  const found = await queue.listJobs({
    status: sp.get("status") ?? undefined,
    queue: sp.get("queue") ?? undefined,
    task: sp.get("task") ?? undefined,
    limit: toNonNegative(limit),
    offset: toNonNegative(offset),
  });
  return found.map(jobToContract);
}

export function job(queue: Queue, id: string) {
  const found = queue.getJob(id);
  return found ? jobToContract(found) : undefined;
}

export async function deadLetters(queue: Queue, url: URL) {
  const dead = await queue.deadLetters(num(url, "limit"), num(url, "offset"));
  return dead.map(deadToContract);
}

export async function metrics(queue: Queue, url: URL) {
  const since = positiveOr(url.searchParams.get("since"), 3600);
  const task = url.searchParams.get("task") ?? undefined;
  return aggregateByTask(await queue.getMetrics(Date.now() - since * 1000, task));
}

export async function timeseries(queue: Queue, url: URL) {
  const since = positiveOr(url.searchParams.get("since"), 3600);
  const bucket = positiveOr(url.searchParams.get("bucket"), 60);
  return bucketTimeseries(
    await queue.getMetrics(Date.now() - since * 1000, undefined),
    bucket * 1000,
  );
}

export async function workers(queue: Queue) {
  return (await queue.listWorkers()).map(workerToContract);
}

export function eventTypes(queue: Queue) {
  return queue.webhooks.eventTypes();
}

export function workflowRuns(queue: Queue, url: URL) {
  const limit = num(url, "limit") ?? 50;
  const offset = num(url, "offset") ?? 0;
  const runs = queue.workflows.list({
    state: url.searchParams.get("state") ?? undefined,
    definitionName: url.searchParams.get("definition_name") ?? undefined,
    limit,
    offset,
  });
  return { runs: runs.map(workflowRunToContract), limit, offset };
}

export function workflowRun(queue: Queue, id: string) {
  const run = queue.workflows.run(id);
  if (!run) {
    return undefined;
  }
  return {
    run: workflowRunToContract(run),
    nodes: queue.workflows.nodes(id).map(workflowNodeToContract),
  };
}

export function workflowDag(queue: Queue, id: string) {
  const dag = queue.workflows.dag(id);
  return dag === undefined ? undefined : { dag: enrichDag(dag, queue.workflows.nodes(id)) };
}

export function workflowChildren(queue: Queue, id: string) {
  // Always empty until sub-workflows are bound (the Node SDK creates no child runs).
  return { children: queue.workflows.children(id).map(workflowRunToContract) };
}

/**
 * Rewrite the raw `SerializableGraph` into the shape the SPA's DAG visualizer
 * consumes: it builds edges from each node's `deps[]` (ignoring top-level
 * `edges`), colours by per-node `status`, and links via `id`. We fold the live
 * node statuses + job ids in so the DAG tab renders real edges, live colours,
 * and correct `/jobs/$id` links. Returns a JSON **string** (the SPA `JSON.parse`s it).
 */
function enrichDag(dagJson: string, nodes: readonly WorkflowNode[]): string {
  let graph: { nodes?: Array<{ name?: string }>; edges?: Array<{ from: string; to: string }> };
  try {
    graph = JSON.parse(dagJson);
  } catch {
    return dagJson; // not our JSON — pass through untouched
  }
  const byName = new Map(nodes.map((n) => [n.nodeName, n]));
  const edges = graph.edges ?? [];
  const enriched = (graph.nodes ?? []).map((raw) => {
    const name = raw.name ?? "";
    const node = byName.get(name);
    return {
      name,
      node_name: name,
      status: node?.status ?? "pending",
      id: node?.jobId ?? name,
      deps: edges.filter((edge) => edge.to === name).map((edge) => edge.from),
    };
  });
  return JSON.stringify({ nodes: enriched, edges });
}

export function webhooks(queue: Queue) {
  return queue.webhooks.list().map(webhookToContract);
}

export function webhook(queue: Queue, id: string) {
  const found = queue.webhooks.get(id);
  return found ? webhookToContract(found) : undefined;
}

export function createWebhook(queue: Queue, body: unknown) {
  // `url` presence + validity is enforced in the manager (throws → 400).
  const created = queue.webhooks.create(parseWebhookInput(body) as WebhookInput);
  // The secret is returned exactly once, on creation.
  return { ...webhookToContract(created), secret: created.secret ?? null };
}

export function updateWebhook(queue: Queue, id: string, body: unknown) {
  const updated = queue.webhooks.update(id, parseWebhookInput(body));
  return updated ? webhookToContract(updated) : undefined;
}

export function deleteWebhook(queue: Queue, id: string) {
  return { deleted: queue.webhooks.delete(id) };
}

export async function testWebhook(queue: Queue, id: string) {
  const delivery = await queue.webhooks.test(id);
  // The SPA's TestWebhookResult wants the HTTP status code (or null).
  return delivery ? { status: delivery.responseCode, delivered: delivery.ok } : undefined;
}

export function webhookDeliveries(queue: Queue, id: string, url: URL) {
  const limit = num(url, "limit") ?? 50;
  const offset = num(url, "offset") ?? 0;
  const statusFilter = url.searchParams.get("status");
  const all = queue.webhooks
    .deliveries(id)
    .filter((delivery) => !statusFilter || delivery.status === statusFilter)
    .reverse(); // newest first, matching the Python delivery store
  return {
    items: all.slice(offset, offset + limit).map(deliveryToContract),
    total: all.length,
    limit,
    offset,
  };
}

/** Parse a snake_case webhook request body into a {@link WebhookInput}. */
function parseWebhookInput(body: unknown): Partial<WebhookInput> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const input: Partial<WebhookInput> = {};
  if (typeof raw.url === "string") input.url = raw.url;
  if (Array.isArray(raw.events)) input.events = raw.events as EventName[];
  if (typeof raw.secret === "string") input.secret = raw.secret;
  if (raw.generate_secret === true) input.secret = randomBytes(24).toString("hex");
  if (raw.headers && typeof raw.headers === "object") {
    input.headers = raw.headers as Record<string, string>;
  }
  if (Array.isArray(raw.task_filter)) input.taskFilter = raw.task_filter as string[];
  if (typeof raw.description === "string") input.description = raw.description;
  if (typeof raw.enabled === "boolean") input.enabled = raw.enabled;
  if (typeof raw.max_retries === "number") input.maxRetries = raw.max_retries;
  if (typeof raw.timeout_seconds === "number") input.timeoutMs = raw.timeout_seconds * 1000;
  return input;
}

// Token-mode auth boot responses: with a shared-token gate there is no user
// store, so the SPA gets a fixed identity once past the token check.
export function openAuthStatus() {
  return { setup_required: false };
}
export function openWhoami() {
  return {
    user: { username: "viewer", role: "admin", created_at: 0, last_login_at: 0 },
    csrf_token: "open",
    expires_at: 9_999_999_999_999,
  };
}

/** Available login providers. OAuth providers are added when configured. */
export function authProviders() {
  return { password_enabled: true, providers: [] };
}

export function cancel(queue: Queue, id: string) {
  return { cancelled: queue.cancelJob(id) || queue.requestCancel(id) };
}
export function retryDead(queue: Queue, id: string) {
  return { new_job_id: queue.retryDead(id) };
}
export function pause(queue: Queue, name: string) {
  queue.pauseQueue(name);
  return { paused: name };
}
export function resume(queue: Queue, name: string) {
  queue.resumeQueue(name);
  return { resumed: name };
}
