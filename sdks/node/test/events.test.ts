import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { type Middleware, type OutcomeEvent, Queue, type Worker } from "../src/index";

let worker: Worker | undefined;

afterEach(() => {
  worker?.stop();
  worker = undefined;
});

function newQueue(): Queue {
  return new Queue({ dbPath: join(mkdtempSync(join(tmpdir(), "taskito-ev-")), "q.db") });
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

it("emits job.completed and runs before/after/onCompleted middleware", async () => {
  const queue = newQueue();
  const calls: string[] = [];
  const events: OutcomeEvent[] = [];
  const middleware: Middleware = {
    before: (ctx) => {
      calls.push(`before:${ctx.taskName}`);
    },
    after: (_ctx, result) => {
      calls.push(`after:${String(result)}`);
    },
    onCompleted: () => {
      calls.push("completed");
    },
  };
  queue.use(middleware);
  queue.on("job.completed", (event) => events.push(event));
  queue.task("add", (a: number, b: number) => a + b);

  queue.enqueue("add", [2, 3]);
  worker = queue.runWorker();

  expect(await waitFor(() => events.length > 0)).toBe(true);
  expect(events[0]?.taskName).toBe("add");
  expect(calls).toContain("before:add");
  expect(calls).toContain("after:5");
  expect(calls).toContain("completed");
});

it("emits job.dead and runs onDeadLetter for an exhausted task", async () => {
  const queue = newQueue();
  const dead: OutcomeEvent[] = [];
  let onDeadLetter = 0;
  queue.on("job.dead", (event) => dead.push(event));
  queue.use({
    onDeadLetter: () => {
      onDeadLetter += 1;
    },
  });
  queue.task(
    "boom",
    () => {
      throw new Error("nope");
    },
    { maxRetries: 0 },
  );

  queue.enqueue("boom");
  worker = queue.runWorker();

  expect(await waitFor(() => dead.length > 0)).toBe(true);
  expect(onDeadLetter).toBeGreaterThanOrEqual(1);
});
