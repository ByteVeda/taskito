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

function freshQueue(): Queue {
  const dbPath = join(mkdtempSync(join(tmpdir(), "taskito-node-saga-")), "queue.db");
  return new Queue({ dbPath });
}

function nodesByName<T extends { nodeName: string }>(handle: {
  nodes: () => T[];
}): Record<string, T | undefined> {
  return Object.fromEntries(handle.nodes().map((n) => [n.nodeName, n]));
}

it("compensates completed steps in reverse order when a later step fails", async () => {
  const queue = freshQueue();
  const rollbacks: string[] = [];

  queue.task("reserve", () => "reservation");
  queue.task("charge", () => "charge-id");
  queue.task("ship", () => {
    throw new Error("out of stock");
  });
  queue.task("unreserve", (forward: string) => rollbacks.push(`unreserve:${forward}`));
  queue.task("refund", (forward: string) => rollbacks.push(`refund:${forward}`));

  const handle = queue.workflows
    .define("saga-order")
    .step("reserve", "reserve", { compensate: "unreserve" })
    .step("charge", "charge", { after: "reserve", compensate: "refund" })
    .step("ship", "ship", { after: "charge", maxRetries: 0 })
    .submit();

  worker = queue.runWorker({ queues: ["default"] });
  const run = await handle.wait({ timeoutMs: 10_000 });

  expect(run.state).toBe("compensated");
  // charge rolls back before reserve (reverse dependency order).
  expect(rollbacks).toEqual(["refund:charge-id", "unreserve:reservation"]);
  const nodes = nodesByName(handle);
  expect(nodes.reserve?.status).toBe("compensated");
  expect(nodes.charge?.status).toBe("compensated");
  expect(nodes.ship?.status).toBe("failed");
});

it("ends in compensation_failed when a compensator fails", async () => {
  const queue = freshQueue();

  queue.task("reserve", () => 1);
  queue.task("ship", () => {
    throw new Error("nope");
  });
  queue.task("unreserve", () => {
    throw new Error("rollback failed");
  });

  const handle = queue.workflows
    .define("saga-bad-rollback")
    .step("reserve", "reserve", { compensate: "unreserve", maxRetries: 0 })
    .step("ship", "ship", { after: "reserve", maxRetries: 0 })
    .submit();

  worker = queue.runWorker({ queues: ["default"] });
  const run = await handle.wait({ timeoutMs: 10_000 });

  expect(run.state).toBe("compensation_failed");
  expect(nodesByName(handle).reserve?.status).toBe("compensation_failed");
});

it("fails normally with no compensation when no step declares a compensator", async () => {
  const queue = freshQueue();

  queue.task("reserve", () => 1);
  queue.task("ship", () => {
    throw new Error("nope");
  });

  const handle = queue.workflows
    .define("saga-none")
    .step("reserve", "reserve")
    .step("ship", "ship", { after: "reserve", maxRetries: 0 })
    .submit();

  worker = queue.runWorker({ queues: ["default"] });
  const run = await handle.wait({ timeoutMs: 10_000 });

  expect(run.state).toBe("failed");
  expect(nodesByName(handle).reserve?.status).toBe("completed"); // not rolled back
});
