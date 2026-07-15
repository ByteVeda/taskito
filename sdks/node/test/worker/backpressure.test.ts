import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Queue, type Worker } from "../../src/index";

let worker: Worker | undefined;

afterEach(() => {
  worker?.stop();
  worker = undefined;
});

function newQueue(): Queue {
  return new Queue({ dbPath: join(mkdtempSync(join(tmpdir(), "taskito-bp-")), "q.db") });
}

async function waitFor(predicate: () => boolean, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

it("never runs more jobs at once than channelCapacity", async () => {
  // The dispatcher used to spawn every job it was handed and immediately take
  // the next, so the job channel drained as fast as the scheduler filled it and
  // nothing bounded in-flight work — the worker claimed jobs it could not run.
  //
  // The task has to outlast several poll ticks (~50ms each) for a backlog to
  // build: a task shorter than the poll interval finishes before the next
  // dispatch, so the poll rate caps concurrency and the test passes either way.
  const queue = newQueue();
  const total = 12;
  const capacity = 3;
  let running = 0;
  let peak = 0;
  let done = 0;

  queue.task("slow", async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 600));
    running -= 1;
    done += 1;
  });

  for (let i = 0; i < total; i += 1) {
    await queue.enqueue("slow");
  }

  worker = queue.runWorker({ queues: ["default"], channelCapacity: capacity });

  expect(await waitFor(() => done >= total)).toBe(true);
  expect(peak).toBeLessThanOrEqual(capacity);
  expect(peak).toBeGreaterThan(1);
});
