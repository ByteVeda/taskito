import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Queue } from "../../src/index";

function newQueue(): Queue {
  return new Queue({ dbPath: join(mkdtempSync(join(tmpdir(), "taskito-sc-")), "q.db") });
}

it("names the task for a malformed task rate limit", () => {
  const queue = newQueue();
  queue.task("t", () => {}, { rateLimit: "100/mm" as never });
  expect(() => queue.runWorker({ queues: ["default"] })).toThrow(/on task 't'/);
});

it("names the queue, not the task, for a malformed queue rate limit", () => {
  const queue = newQueue();
  queue.task("t", () => {});
  queue.configureQueue("default", { rateLimit: "100/mm" as never });
  expect(() => queue.runWorker({ queues: ["default"] })).toThrow(/on queue 'default'/);
});
