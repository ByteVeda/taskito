import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { allOf, anyOf, not, PredicateRejectedError, Queue } from "../../src/index";

function newQueue(): Queue {
  return new Queue({ dbPath: join(mkdtempSync(join(tmpdir(), "taskito-pred-")), "q.db") });
}

it("enqueues when the gate passes", () => {
  const queue = newQueue().task("charge", (n: number) => n);
  queue.gate("charge", ({ args }) => args[0] > 0);
  expect(typeof queue.enqueue("charge", [5])).toBe("string");
});

it("rejects the enqueue when the gate fails", () => {
  const queue = newQueue().task("charge", (n: number) => n);
  queue.gate("charge", ({ args }) => args[0] > 0);
  expect(() => queue.enqueue("charge", [-1])).toThrow(PredicateRejectedError);
  expect(queue.stats().pending).toBe(0);
});

it("requires every gate to pass", () => {
  const queue = newQueue().task("t", (n: number) => n);
  queue.gate("t", ({ args }) => args[0] > 0);
  queue.gate("t", ({ args }) => args[0] < 100);
  expect(typeof queue.enqueue("t", [50])).toBe("string");
  expect(() => queue.enqueue("t", [200])).toThrow(PredicateRejectedError);
});

it("sees args after onEnqueue rewrites them", () => {
  const queue = newQueue().task("t", (n: number) => n);
  queue.use({
    onEnqueue: (ctx) => {
      ctx.args = [Math.abs(ctx.args[0] as number)];
    },
  });
  queue.gate("t", ({ args }) => args[0] > 0);
  expect(typeof queue.enqueue("t", [-5])).toBe("string"); // rewritten to 5 → passes
});

it("composes predicates with allOf / anyOf / not", () => {
  const queue = newQueue().task("t", (n: number) => n);
  const positive = ({ args }: { args: readonly unknown[] }) => (args[0] as number) > 0;
  const even = ({ args }: { args: readonly unknown[] }) => (args[0] as number) % 2 === 0;
  queue.gate("t", allOf(positive, not(even)));
  expect(typeof queue.enqueue("t", [3])).toBe("string"); // positive, odd
  expect(() => queue.enqueue("t", [4])).toThrow(PredicateRejectedError); // even
  expect(() => queue.enqueue("t", [-3])).toThrow(PredicateRejectedError); // not positive

  const q2 = newQueue().task("t", (n: number) => n);
  q2.gate("t", anyOf(positive, even));
  expect(typeof q2.enqueue("t", [-2])).toBe("string"); // negative but even
});

it("gates each job in a batch", () => {
  const queue = newQueue().task("t", (n: number) => n);
  queue.gate("t", ({ args }) => args[0] > 0);
  expect(() => queue.enqueueMany("t", [{ args: [1] }, { args: [-1] }])).toThrow(
    PredicateRejectedError,
  );
});
