import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Queue, type Worker } from "../src/index";

let worker: Worker | undefined;

afterEach(() => {
  worker?.stop();
  worker = undefined;
});

function freshQueue(): Queue {
  const dbPath = join(mkdtempSync(join(tmpdir(), "taskito-node-cron-")), "queue.db");
  return new Queue({ dbPath });
}

// The Rust `cron` crate uses 6/7-field expressions (seconds first):
// `sec min hour day-of-month month day-of-week [year]`.
it("registers a cron task and returns its next fire time", () => {
  const queue = freshQueue();
  queue.task("beat", () => null);

  const now = Date.now();
  const next = queue.registerPeriodic("heartbeat", "beat", "0 */5 * * * *", { args: [] });
  expect(next).toBeGreaterThan(now);

  // Re-register (upsert) the same name with a different schedule.
  const next2 = queue.registerPeriodic("heartbeat", "beat", "0 0 * * * *");
  expect(next2).toBeGreaterThan(now);
});

it("rejects an invalid cron expression", () => {
  const queue = freshQueue();
  queue.task("beat", () => null);
  expect(() => queue.registerPeriodic("bad", "beat", "not a cron")).toThrow();
});

it("accepts a circuit-breaker config and still runs the task", async () => {
  const queue = freshQueue();
  queue.task("guarded", (x: number) => x * 2, {
    circuitBreaker: { threshold: 3, windowMs: 60_000, cooldownMs: 60_000 },
  });
  const id = queue.enqueue("guarded", [21]);
  worker = queue.runWorker();
  expect(await queue.result(id, { timeoutMs: 8000 })).toBe(42);
});
