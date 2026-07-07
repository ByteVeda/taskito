// Operational endpoints: liveness/readiness probes, the KEDA scaler payload,
// and worker-resource health aggregated from heartbeats.

import type { Queue } from "../../index";

/** Basic liveness check — always ok. */
export function health() {
  return { status: "ok" };
}

/** Readiness: storage reachable, workers alive, resources healthy. */
export async function readiness(queue: Queue) {
  const checks: Record<string, unknown> = {};
  let allOk = true;

  try {
    await queue.stats();
    checks.storage = "ok";
  } catch (error) {
    checks.storage = `error: ${String(error)}`;
    allOk = false;
  }

  try {
    const workers = await queue.listWorkers();
    checks.workers = { count: workers.length, status: workers.length > 0 ? "ok" : "none" };
  } catch (error) {
    checks.workers = `error: ${String(error)}`;
    allOk = false;
  }

  try {
    const resources = await resourceStatus(queue);
    if (resources.length > 0) {
      const unhealthy = resources.filter((r) => r.health !== "healthy").map((r) => r.name);
      checks.resources = {
        count: resources.length,
        unhealthy,
        status: unhealthy.length > 0 ? "degraded" : "ok",
      };
      if (unhealthy.length > 0) {
        allOk = false;
      }
    }
  } catch (error) {
    checks.resources = `error: ${String(error)}`;
    allOk = false;
  }

  return { status: allOk ? "ready" : "degraded", checks };
}

export interface ResourceStatusEntry {
  name: string;
  scope: string;
  health: string;
  init_duration_ms: number;
  recreations: number;
  depends_on: string[];
}

/**
 * Worker-resource health aggregated from heartbeat snapshots: any
 * `unhealthy` report wins; mixed healthy/unhealthy is `degraded`; all
 * healthy → `healthy`; advertised but not yet reported → `not_initialized`.
 */
export async function resourceStatus(queue: Queue): Promise<ResourceStatusEntry[]> {
  const observed = new Map<string, string[]>();
  const advertised = new Set<string>();
  for (const worker of await queue.listWorkers()) {
    for (const name of parseJsonArray(worker.resources)) {
      advertised.add(name);
    }
    const report = parseJsonObject(worker.resourceHealth);
    for (const [name, healthValue] of Object.entries(report)) {
      const entries = observed.get(name) ?? [];
      entries.push(String(healthValue).toLowerCase());
      observed.set(name, entries);
    }
  }

  const names = new Set([...advertised, ...observed.keys()]);
  return [...names].sort().map((name) => {
    const reports = observed.get(name) ?? [];
    let healthState = "not_initialized";
    if (reports.length > 0) {
      const unhealthy = reports.filter((r) => r !== "healthy").length;
      healthState =
        unhealthy === 0 ? "healthy" : unhealthy === reports.length ? "unhealthy" : "degraded";
    }
    return {
      name,
      scope: "worker",
      health: healthState,
      init_duration_ms: 0,
      recreations: 0,
      depends_on: [],
    };
  });
}

/** KEDA-compatible scaler payload for the whole queue or one named queue. */
export async function scaler(queue: Queue, url: URL) {
  const targetQueueDepth = positiveIntOr(url.searchParams.get("target"), 10);
  const queueName = url.searchParams.get("queue");

  const stats = await queue.stats();
  const workers = await queue.listWorkers();
  const totalCapacity = workers.reduce((sum, w) => sum + (w.threads ?? 0), 0);

  const response: Record<string, unknown> = {
    metricName: "taskito_queue_depth",
    metricValue: stats.pending,
    isActive: stats.pending > 0,
    liveWorkers: workers.length,
    totalCapacity,
    targetQueueDepth,
  };
  if (totalCapacity > 0) {
    response.workerUtilization = Math.round((stats.running / totalCapacity) * 1000) / 1000;
  }

  if (queueName) {
    const queueStats = await queue.statsByQueue(queueName);
    response.metricValue = queueStats.pending;
    response.isActive = queueStats.pending > 0;
    response.metricName = `taskito_queue_depth_${queueName}`;
  }

  const perQueue: Record<string, { pending: number; running: number }> = {};
  for (const [name, s] of Object.entries(await queue.statsAllQueues())) {
    perQueue[name] = { pending: s.pending, running: s.running };
  }
  response.perQueue = perQueue;

  return response;
}

function positiveIntOr(value: string | null, fallback: number): number {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonArray(raw: string | undefined | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | undefined | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
