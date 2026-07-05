import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Queue, TaskitoError, useResource, type Worker } from "../../src/index";
import { ResourceRuntime } from "../../src/resources/runtime";

let worker: Worker | undefined;

afterEach(() => {
  worker?.stop();
  worker = undefined;
});

function newQueue(): Queue {
  return new Queue({ dbPath: join(mkdtempSync(join(tmpdir(), "taskito-res-")), "q.db") });
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

describe("ResourceRuntime", () => {
  it("builds a worker-scoped resource once across many resolutions", async () => {
    const rt = new ResourceRuntime();
    let builds = 0;
    rt.register("cfg", {
      scope: "worker",
      factory: () => {
        builds += 1;
        return { n: builds };
      },
    });
    const a = rt.createTaskScope();
    const b = rt.createTaskScope();
    expect(await a.resolver("cfg")).toEqual({ n: 1 });
    expect(await a.resolver("cfg")).toEqual({ n: 1 });
    expect(await b.resolver("cfg")).toEqual({ n: 1 });
    expect(builds).toBe(1);
  });

  it("re-registering a worker resource replaces the built instance", async () => {
    const rt = new ResourceRuntime();
    rt.register("cfg", { scope: "worker", factory: () => ({ version: 1 }) });
    const scope = rt.createTaskScope();
    expect(await scope.resolver("cfg")).toEqual({ version: 1 });

    rt.register("cfg", { scope: "worker", factory: () => ({ version: 2 }) });
    expect(await scope.resolver("cfg")).toEqual({ version: 2 });
  });

  it("builds a task-scoped resource once per scope, fresh across scopes", async () => {
    const rt = new ResourceRuntime();
    let builds = 0;
    rt.register("conn", {
      scope: "task",
      factory: () => {
        builds += 1;
        return builds;
      },
    });
    const a = rt.createTaskScope();
    expect(await a.resolver("conn")).toBe(1);
    expect(await a.resolver("conn")).toBe(1); // same scope → cached
    const b = rt.createTaskScope();
    expect(await b.resolver("conn")).toBe(2); // new scope → rebuilt
    expect(builds).toBe(2);
  });

  it("disposes worker-scoped resources LIFO on teardown", async () => {
    const rt = new ResourceRuntime();
    const order: string[] = [];
    rt.register("a", { scope: "worker", factory: () => "a", dispose: () => void order.push("a") });
    rt.register("b", { scope: "worker", factory: () => "b", dispose: () => void order.push("b") });
    const s = rt.createTaskScope();
    await s.resolver("a");
    await s.resolver("b");
    await rt.teardownWorker();
    expect(order).toEqual(["b", "a"]); // reverse of build order
  });

  it("disposes worker resources only when the last sharing worker stops", async () => {
    const rt = new ResourceRuntime();
    let disposed = 0;
    rt.register("conn", {
      scope: "worker",
      factory: () => "c",
      dispose: () => {
        disposed += 1;
      },
    });
    rt.acquireWorker();
    rt.acquireWorker();
    await rt.createTaskScope().resolver("conn");

    await rt.teardownWorker(); // one of two workers stopped
    expect(disposed).toBe(0); // still in use by the sibling worker

    await rt.teardownWorker(); // last worker stopped
    expect(disposed).toBe(1);
  });

  it("disposes task-scoped resources LIFO when the scope ends", async () => {
    const rt = new ResourceRuntime();
    const order: string[] = [];
    rt.register("x", { scope: "task", factory: () => "x", dispose: () => void order.push("x") });
    rt.register("y", { scope: "task", factory: () => "y", dispose: () => void order.push("y") });
    const s = rt.createTaskScope();
    await s.resolver("x");
    await s.resolver("y");
    await s.teardown();
    expect(order).toEqual(["y", "x"]);
  });

  it("lets a factory depend on another resource via ctx.use", async () => {
    const rt = new ResourceRuntime();
    rt.register("base", { scope: "worker", factory: () => 10 });
    rt.register("derived", {
      scope: "worker",
      factory: async (ctx) => (await ctx.use<number>("base")) * 2,
    });
    const s = rt.createTaskScope();
    expect(await s.resolver("derived")).toBe(20);
  });

  it("rejects a worker factory depending on a task-scoped resource", async () => {
    const rt = new ResourceRuntime();
    rt.register("perJob", { scope: "task", factory: () => "x" });
    rt.register("singleton", {
      scope: "worker",
      factory: (ctx) => ctx.use("perJob"),
    });
    const s = rt.createTaskScope();
    await expect(s.resolver("singleton")).rejects.toThrow(/task-scoped/);
  });

  it("throws for an unregistered resource", async () => {
    const rt = new ResourceRuntime();
    const s = rt.createTaskScope();
    await expect(s.resolver("nope")).rejects.toThrow(/No resource registered/);
  });

  it("retries a failed build instead of caching the rejection", async () => {
    const rt = new ResourceRuntime();
    let attempts = 0;
    rt.register("flaky", {
      scope: "worker",
      factory: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("transient");
        }
        return "ok";
      },
    });
    const s = rt.createTaskScope();
    await expect(s.resolver("flaky")).rejects.toThrow("transient");
    expect(await s.resolver("flaky")).toBe("ok"); // second attempt succeeds
  });
});

describe("resource injection in a worker", () => {
  it("resolves a worker-scoped resource via useResource(), shared across jobs", async () => {
    const queue = newQueue();
    let builds = 0;
    let disposed = false;
    queue.resource(
      "config",
      () => {
        builds += 1;
        return { token: "secret" };
      },
      {
        dispose: () => {
          disposed = true;
        },
      },
    );
    const seen: string[] = [];
    queue.task("read", async () => {
      const cfg = await useResource<{ token: string }>("config");
      seen.push(cfg.token);
    });

    queue.enqueue("read");
    queue.enqueue("read");
    worker = queue.runWorker();

    expect(await waitFor(() => seen.length === 2)).toBe(true);
    expect(seen).toEqual(["secret", "secret"]);
    expect(builds).toBe(1); // singleton across both jobs

    worker.stop();
    worker = undefined;
    expect(await waitFor(() => disposed)).toBe(true);
  });

  it("injects declared resources as a trailing deps argument", async () => {
    const queue = newQueue();
    queue.resource("db", () => ({ query: () => 7 }));
    let got = 0;
    queue.task(
      "use-db",
      (factor: number, deps: { db: { query: () => number } }) => {
        got = deps.db.query() * factor;
      },
      { inject: ["db"] },
    );

    queue.enqueue("use-db", [3]);
    worker = queue.runWorker();

    expect(await waitFor(() => got !== 0)).toBe(true);
    expect(got).toBe(21);
  });

  it("builds and disposes a task-scoped resource per job", async () => {
    const queue = newQueue();
    let builds = 0;
    let disposals = 0;
    queue.resource(
      "tx",
      () => {
        builds += 1;
        return builds;
      },
      {
        scope: "task",
        dispose: () => {
          disposals += 1;
        },
      },
    );
    queue.task("work", async () => {
      await useResource("tx");
    });

    queue.enqueue("work");
    queue.enqueue("work");
    worker = queue.runWorker();

    expect(await waitFor(() => disposals === 2)).toBe(true);
    expect(builds).toBe(2); // one per invocation
  });

  it("throws when useResource is called outside a task", () => {
    expect(() => useResource("anything")).toThrow(TaskitoError);
  });

  it("strips the injected deps arg from typed enqueue", () => {
    const q = newQueue().task("inj", (id: string, deps: { db: number }) => `${id}:${deps.db}`, {
      inject: ["db"],
    });
    // Type-only: never executed. Asserts `deps` is not part of the enqueue args.
    const _typeCheck = () => {
      q.enqueue("inj", ["a"]);
      // @ts-expect-error deps must not be passed as an enqueue arg
      q.enqueue("inj", ["a", { db: 1 }]);
    };
    void _typeCheck;
    expect(true).toBe(true);
  });
});
