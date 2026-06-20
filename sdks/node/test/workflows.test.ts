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
  const dbPath = join(mkdtempSync(join(tmpdir(), "taskito-node-wf-")), "queue.db");
  return new Queue({ dbPath });
}

it("runs a linear DAG to completion in dependency order", async () => {
  const queue = freshQueue();
  const ran: string[] = [];
  queue.task("extract", () => {
    ran.push("extract");
    return { rows: 3 };
  });
  queue.task("transform", () => {
    ran.push("transform");
    return "done";
  });

  const handle = queue.workflows
    .define("etl")
    .step("extract", "extract")
    .step("transform", "transform", { after: "extract" })
    .submit();

  worker = queue.runWorker({ queues: ["default"] });
  const run = await handle.wait({ timeoutMs: 8000 });

  expect(run.state).toBe("completed");
  expect(ran).toEqual(["extract", "transform"]);
  const status = Object.fromEntries(handle.nodes().map((n) => [n.nodeName, n.status]));
  expect(status).toEqual({ extract: "completed", transform: "completed" });
});

it("fails the run and skips downstream steps when a step dead-letters", async () => {
  const queue = freshQueue();
  queue.task("ok", () => 1);
  queue.task("boom", () => {
    throw new Error("kaboom");
  });
  queue.task("after", () => 2);

  const handle = queue.workflows
    .define("failing")
    .step("a", "ok")
    .step("b", "boom", { after: "a", maxRetries: 0 })
    .step("c", "after", { after: "b" })
    .submit();

  worker = queue.runWorker();
  const run = await handle.wait({ timeoutMs: 8000 });

  expect(run.state).toBe("failed");
  const status = Object.fromEntries(handle.nodes().map((n) => [n.nodeName, n.status]));
  expect(status.a).toBe("completed");
  expect(status.b).toBe("failed");
  expect(status.c).toBe("skipped");
});

it("lists submitted runs and filters by state", async () => {
  const queue = freshQueue();
  queue.task("noop", () => null);

  const handle = queue.workflows.define("listme").step("only", "noop").submit();
  worker = queue.runWorker();
  await handle.wait({ timeoutMs: 8000 });

  const completed = queue.workflows.list({ state: "completed" });
  expect(completed.map((r) => r.id)).toContain(handle.runId);
});
