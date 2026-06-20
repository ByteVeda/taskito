import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "prom-client";
import { afterEach, expect, it } from "vitest";
import { PrometheusStatsCollector, prometheusMiddleware } from "../src/contrib/prometheus";
import { Queue, type Worker } from "../src/index";

let worker: Worker | undefined;

afterEach(() => {
  worker?.stop();
  worker = undefined;
});

function newQueue(): Queue {
  return new Queue({ dbPath: join(mkdtempSync(join(tmpdir(), "taskito-prom-")), "q.db") });
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

it("records job counters and a duration histogram", async () => {
  const register = new Registry();
  const queue = newQueue();
  queue.use(prometheusMiddleware({ register }));
  queue.task("add", (a: number, b: number) => a + b);
  queue.task(
    "boom",
    () => {
      throw new Error("nope");
    },
    { maxRetries: 0 },
  );

  queue.enqueue("add", [1, 2]);
  queue.enqueue("boom", []);
  worker = queue.runWorker();

  expect(await waitFor(() => queue.stats().completed >= 1 && queue.stats().dead >= 1)).toBe(true);

  const text = await register.metrics();
  expect(text).toContain('taskito_jobs_total{task="add",status="completed"} 1');
  expect(text).toContain('taskito_jobs_total{task="boom",status="failed"} 1');
  expect(text).toContain("taskito_job_duration_seconds_count");
  expect(text).toContain("taskito_active_workers 0");
});

it("shares one metric store per (registry, namespace)", () => {
  const register = new Registry();
  // Two middlewares on the same registry/namespace must not double-register.
  expect(() => {
    prometheusMiddleware({ register });
    prometheusMiddleware({ register });
  }).not.toThrow();
});

it("samples queue depth and DLQ size", async () => {
  const register = new Registry();
  const queue = newQueue();
  queue.task(
    "boom",
    () => {
      throw new Error("nope");
    },
    { maxRetries: 0 },
  );

  // Pending jobs (no worker yet) → queue depth.
  queue.enqueue("boom", []);
  queue.enqueue("boom", []);

  const collector = new PrometheusStatsCollector(queue, { register, intervalMs: 60_000 });
  collector.start();
  let text = await register.metrics();
  expect(text).toContain('taskito_queue_depth{queue="default"} 2');

  // Drain to the DLQ, then re-sample.
  worker = queue.runWorker();
  expect(await waitFor(() => queue.stats().dead >= 2)).toBe(true);
  collector.sample();
  text = await register.metrics();
  expect(text).toContain("taskito_dlq_size 2");
  collector.stop();
});
