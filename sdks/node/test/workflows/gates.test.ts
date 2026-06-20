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
  const dbPath = join(mkdtempSync(join(tmpdir(), "taskito-node-gate-")), "queue.db");
  return new Queue({ dbPath });
}

function nodesByName<T extends { nodeName: string }>(handle: {
  nodes: () => T[];
}): Record<string, T | undefined> {
  return Object.fromEntries(handle.nodes().map((n) => [n.nodeName, n]));
}

async function waitFor(predicate: () => boolean, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

it("pauses at a gate and runs downstream once approved", async () => {
  const queue = freshQueue();
  let released = false;

  queue.task("prepare", () => 1);
  queue.task("ship", () => {
    released = true;
  });

  const handle = queue.workflows
    .define("gate-approve")
    .step("prepare", "prepare")
    .gate("review", { after: "prepare" })
    .step("ship", "ship", { after: "review" })
    .submit();

  worker = queue.runWorker({ queues: ["default"] });

  // The run parks at the gate until approved.
  expect(await waitFor(() => nodesByName(handle).review?.status === "waiting_approval")).toBe(true);
  expect(released).toBe(false);
  expect(handle.status()?.state).toBe("running");

  queue.workflows.approveGate(handle.runId, "review");

  const run = await handle.wait({ timeoutMs: 8000 });
  expect(run.state).toBe("completed");
  expect(released).toBe(true);
  expect(nodesByName(handle).review?.status).toBe("completed");
});

it("skips downstream and fails the run when a gate is rejected", async () => {
  const queue = freshQueue();
  queue.task("prepare", () => 1);
  queue.task("ship", () => 2);

  const handle = queue.workflows
    .define("gate-reject")
    .step("prepare", "prepare")
    .gate("review", { after: "prepare" })
    .step("ship", "ship", { after: "review" })
    .submit();

  worker = queue.runWorker({ queues: ["default"] });
  expect(await waitFor(() => nodesByName(handle).review?.status === "waiting_approval")).toBe(true);

  queue.workflows.rejectGate(handle.runId, "review", "not allowed");

  const run = await handle.wait({ timeoutMs: 8000 });
  expect(run.state).toBe("failed");
  const nodes = nodesByName(handle);
  expect(nodes.review?.status).toBe("failed");
  expect(nodes.ship?.status).toBe("skipped");
});

it("auto-resolves a gate on timeout per onTimeout", async () => {
  const queue = freshQueue();
  let shipped = false;

  queue.task("prepare", () => 1);
  queue.task("ship", () => {
    shipped = true;
  });

  const handle = queue.workflows
    .define("gate-timeout")
    .step("prepare", "prepare")
    .gate("review", { after: "prepare", timeoutMs: 200, onTimeout: "approve" })
    .step("ship", "ship", { after: "review" })
    .submit();

  worker = queue.runWorker({ queues: ["default"] });
  const run = await handle.wait({ timeoutMs: 8000 });

  expect(run.state).toBe("completed"); // timeout approved the gate
  expect(shipped).toBe(true);
  expect(nodesByName(handle).review?.status).toBe("completed");
});
