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
  return new Queue({ dbPath: join(mkdtempSync(join(tmpdir(), "taskito-batch-")), "q.db") });
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

it("enqueueMany inserts a batch and returns ids in order", () => {
  const queue = newQueue();
  queue.task("double", (n: number) => n * 2);

  const ids = queue.enqueueMany("double", [{ args: [1] }, { args: [2] }, { args: [3] }]);
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(3); // distinct ids
  expect(queue.stats().pending).toBe(3);
});

it("runs every job in the batch", async () => {
  const queue = newQueue();
  const seen: number[] = [];
  queue.task("collect", (n: number) => {
    seen.push(n);
    return n;
  });

  const ids = queue.enqueueMany("collect", [{ args: [10] }, { args: [20] }, { args: [30] }]);
  worker = queue.runWorker();

  expect(await waitFor(() => seen.length === 3)).toBe(true);
  expect([...seen].sort((a, b) => a - b)).toEqual([10, 20, 30]);
  expect(await queue.result(ids[0] as string)).toBe(10);
});

it("applies per-job options across the batch", () => {
  const queue = newQueue();
  queue.task("noop", () => undefined);

  const ids = queue.enqueueMany("noop", [
    { options: { queue: "a", priority: 5 } },
    { options: { queue: "b" } },
  ]);
  expect(queue.getJob(ids[0] as string)?.queue).toBe("a");
  expect(queue.getJob(ids[1] as string)?.queue).toBe("b");
});

it("runs onEnqueue interception for each batched job", () => {
  const queue = newQueue();
  let calls = 0;
  queue.use({
    onEnqueue: () => {
      calls += 1;
    },
  });
  queue.task("noop", () => undefined);

  queue.enqueueMany("noop", [{}, {}, {}]);
  expect(calls).toBe(3);
});
