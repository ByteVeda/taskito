// Log topics (S28): one stored message per publish, pulled via a cursor.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Queue, type Worker } from "../../src/index";

let worker: Worker | undefined;
let activeQueue: Queue | undefined;

afterEach(async () => {
  worker?.stop();
  worker = undefined;
  // Await deregistration so scheduler threads don't accumulate into the next
  // test (a queue that never ran a worker returns instantly).
  if (activeQueue) {
    const q = activeQueue;
    activeQueue = undefined;
    await waitFor(async () => (await q.listWorkers()).length === 0, 30000);
  }
});

function newQueue(): Queue {
  activeQueue = new Queue({
    dbPath: join(mkdtempSync(join(tmpdir(), "taskito-pubsub-log-")), "q.db"),
  });
  return activeQueue;
}

// Huge ceilings: real-worker startup on a cold, CPU-starved smoke runner can
// take tens of seconds. The predicate returns the instant it's true.
const WORKER_TEST_TIMEOUT_MS = 60000;

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 40000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

/** Narrow an array element to non-undefined (strict indexed access). */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

it("stores one message per publish, regardless of readers", async () => {
  const queue = newQueue();
  await queue.subscribeLog("events", "analytics");

  // No fan-out jobs; one stored message per publish.
  expect(await queue.publish("events", [1])).toEqual([]);
  expect(await queue.publish("events", [2])).toEqual([]);

  const msgs = await queue.readTopic("events", "analytics");
  expect(msgs.map((m) => m.args)).toEqual([[1], [2]]);
});

it("advances the cursor on ack and is monotonic", async () => {
  const queue = newQueue();
  await queue.subscribeLog("events", "c");
  for (let i = 0; i < 3; i++) await queue.publish("events", [i]);

  const msgs = await queue.readTopic("events", "c");
  expect(msgs.map((m) => m.args[0])).toEqual([0, 1, 2]);

  // Ack through the middle: the next read starts after it.
  expect(await queue.ackTopic("events", "c", must(msgs[1]).id)).toBe(true);
  expect((await queue.readTopic("events", "c")).map((m) => m.args[0])).toEqual([2]);

  // Acking an older id never rewinds.
  expect(await queue.ackTopic("events", "c", must(msgs[0]).id)).toBe(false);
  expect((await queue.readTopic("events", "c")).map((m) => m.args[0])).toEqual([2]);
});

it("re-delivers un-acked messages (at-least-once)", async () => {
  const queue = newQueue();
  await queue.subscribeLog("events", "c");
  await queue.publish("events", ["x"]);
  expect((await queue.readTopic("events", "c")).map((m) => m.args)).toEqual([["x"]]);
  expect((await queue.readTopic("events", "c")).map((m) => m.args)).toEqual([["x"]]);
});

it("bounds a read by limit", async () => {
  const queue = newQueue();
  await queue.subscribeLog("events", "c");
  for (let i = 0; i < 5; i++) await queue.publish("events", [i]);

  const first = await queue.readTopic("events", "c", 2);
  expect(first.map((m) => m.args[0])).toEqual([0, 1]);
  await queue.ackTopic("events", "c", must(first[first.length - 1]).id);
  expect((await queue.readTopic("events", "c", 2)).map((m) => m.args[0])).toEqual([2, 3]);
});

it("reports lag per log subscription", async () => {
  const queue = newQueue();
  await queue.subscribeLog("events", "c");
  for (let i = 0; i < 3; i++) await queue.publish("events", [i]);

  let stat = must((await queue.topicLogStats())[0]);
  expect(stat.subscription).toBe("c");
  expect(stat.cursor).toBeUndefined();
  expect(stat.lag).toBe(3);

  const msgs = await queue.readTopic("events", "c");
  await queue.ackTopic("events", "c", must(msgs[msgs.length - 1]).id);
  stat = must((await queue.topicLogStats())[0]);
  expect(stat.lag).toBe(0);
});

it(
  "drives a managed consumer: pull, invoke handler, advance cursor",
  async () => {
    const queue = newQueue();
    const received: number[] = [];
    queue.logConsumer(
      "events",
      "c",
      (n: number) => {
        received.push(n);
      },
      { pollIntervalMs: 20 },
    );

    worker = queue.runWorker({ concurrency: 1 });
    for (let i = 0; i < 3; i++) await queue.publish("events", [i]);

    expect(await waitFor(() => received.length === 3)).toBe(true);
    expect([...received].sort()).toEqual([0, 1, 2]);
    expect(must((await queue.topicLogStats())[0]).lag).toBe(0);
  },
  WORKER_TEST_TIMEOUT_MS,
);

it(
  "awaits an async managed-consumer handler",
  async () => {
    const queue = newQueue();
    const received: number[] = [];
    queue.logConsumer(
      "events",
      "c",
      async (n: number) => {
        await new Promise((r) => setTimeout(r, 1));
        received.push(n);
      },
      { pollIntervalMs: 20 },
    );

    worker = queue.runWorker({ concurrency: 1 });
    await queue.publish("events", [42]);
    expect(await waitFor(() => received.length === 1)).toBe(true);
    expect(received).toEqual([42]);
  },
  WORKER_TEST_TIMEOUT_MS,
);

it(
  "retry mode re-delivers a failed message but not acked predecessors",
  async () => {
    const queue = newQueue();
    const attempts: number[] = [];
    let failed = false;
    queue.logConsumer(
      "events",
      "c",
      (n: number) => {
        attempts.push(n);
        if (n === 1 && !failed) {
          failed = true;
          throw new Error("boom");
        }
      },
      { pollIntervalMs: 20, onError: "retry" },
    );

    worker = queue.runWorker({ concurrency: 1 });
    for (let i = 0; i < 3; i++) await queue.publish("events", [i]);

    expect(
      await waitFor(() => attempts.filter((n) => n === 1).length === 2 && attempts.includes(2)),
    ).toBe(true);
    // 0 was acked before the failure → never redelivered.
    expect(attempts.filter((n) => n === 0).length).toBe(1);
  },
  WORKER_TEST_TIMEOUT_MS,
);

it(
  "skip mode acks past a poison message",
  async () => {
    const queue = newQueue();
    const attempts: number[] = [];
    queue.logConsumer(
      "events",
      "c",
      (n: number) => {
        attempts.push(n);
        if (n === 1) throw new Error("always poison");
      },
      { pollIntervalMs: 20, onError: "skip" },
    );

    worker = queue.runWorker({ concurrency: 1 });
    for (let i = 0; i < 3; i++) await queue.publish("events", [i]);

    expect(await waitFor(() => [...attempts].sort().join() === "0,1,2")).toBe(true);
    expect(must((await queue.topicLogStats())[0]).lag).toBe(0);
    expect(attempts.filter((n) => n === 1).length).toBe(1);
  },
  WORKER_TEST_TIMEOUT_MS,
);

it(
  "lets log and fan-out subscribers coexist on one topic",
  async () => {
    const queue = newQueue();
    const seen: number[] = [];
    queue.subscriber("events", "worker", (n: number) => {
      seen.push(n);
    });
    await queue.declareSubscriptions();
    await queue.subscribeLog("events", "log");

    worker = queue.runWorker({ concurrency: 1 });
    await queue.publish("events", [7]);

    expect(await waitFor(() => seen.length === 1)).toBe(true);
    expect(seen).toEqual([7]);
    // The same publish stored one log message.
    expect((await queue.readTopic("events", "log")).map((m) => m.args)).toEqual([[7]]);
  },
  WORKER_TEST_TIMEOUT_MS,
);
