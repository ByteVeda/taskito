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
  return new Queue({ dbPath: join(mkdtempSync(join(tmpdir(), "taskito-tc-")), "q.db") });
}

async function waitFor(predicate: () => boolean, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

it("registers a task that sets only maxInFlightPerTask", async () => {
  // The config collector used to gate on a hand-listed set of option names, so
  // a task setting only an option missing from that list was dropped before it
  // reached the scheduler — silently, and invisibly to type-checking. A job
  // still runs either way, so assert the option reaches native by giving it a
  // value the scheduler must honour: one slot means strictly serial execution.
  const queue = newQueue();
  const total = 4;
  let running = 0;
  let peak = 0;
  let done = 0;

  queue.task(
    "solo",
    async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 150));
      running -= 1;
      done += 1;
    },
    { maxInFlightPerTask: 1 },
  );

  for (let i = 0; i < total; i += 1) {
    await queue.enqueue("solo");
  }

  worker = queue.runWorker({ queues: ["default"], concurrency: 4, batchSize: total });

  expect(await waitFor(() => done >= total)).toBe(true);
  expect(peak).toBe(1);
});

it("rejects a malformed rateLimit rather than silently disabling it", async () => {
  const queue = newQueue();
  queue.task("bad", async () => {}, { rateLimit: "100/mm" as never });
  expect(() => queue.runWorker({ queues: ["default"] })).toThrow(/rateLimit/);
});
