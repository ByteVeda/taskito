import { execSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { Queue, serveDashboard, type Worker } from "../src/index";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const staticDir = join(pkgRoot, "static", "dashboard");

beforeAll(() => {
  if (!existsSync(join(staticDir, "index.html"))) {
    execSync("pnpm run build:dashboard", { cwd: pkgRoot, stdio: "ignore" });
  }
}, 120_000);

let server: Server | undefined;
let base = "";

beforeEach(async () => {
  const db = join(mkdtempSync(join(tmpdir(), "taskito-dash-")), "q.db");
  const queue = new Queue({ dbPath: db });
  queue.task("add", (a: number, b: number) => a + b);
  queue.enqueue("add", [1, 2]);
  queue.pauseQueue("emails");
  server = serveDashboard(queue, { port: 0, staticDir });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(() => {
  server?.close();
  server = undefined;
});

it("serves queue stats", async () => {
  const stats = (await (await fetch(`${base}/api/stats`)).json()) as { pending: number };
  expect(stats.pending).toBe(1);
});

it("serves jobs in the snake_case SPA contract", async () => {
  const jobs = (await (await fetch(`${base}/api/jobs`)).json()) as Array<{
    task_name: string;
    created_at: number;
  }>;
  expect(jobs[0]?.task_name).toBe("add");
  expect(typeof jobs[0]?.created_at).toBe("number");
});

it("exposes paused queues", async () => {
  const paused = await (await fetch(`${base}/api/queues/paused`)).json();
  expect(paused).toContain("emails");
});

it("fakes open-mode auth so the SPA boots", async () => {
  const status = (await (await fetch(`${base}/api/auth/status`)).json()) as {
    setup_required: boolean;
  };
  expect(status.setup_required).toBe(false);
  const who = await fetch(`${base}/api/auth/whoami`);
  expect(who.headers.get("set-cookie") ?? "").toMatch(/taskito_csrf/);
  const body = (await who.json()) as { user: { role: string } };
  expect(body.user.role).toBe("admin");
});

it("serves the SPA shell with deep-link fallback", async () => {
  expect((await fetch(`${base}/`)).status).toBe(200);
  expect((await fetch(`${base}/jobs`)).status).toBe(200);
  expect((await fetch(`${base}/assets/missing-xyz.js`)).status).toBe(404);
});

it("creates and lists webhooks via the dashboard api", async () => {
  const created = (await (
    await fetch(`${base}/api/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://example.com/h", events: ["job.completed"], secret: "x" }),
    })
  ).json()) as { id: string; has_secret: boolean; secret: string | null };
  expect(created.has_secret).toBe(true);
  expect(created.secret).toBe("x");

  const list = (await (await fetch(`${base}/api/webhooks`)).json()) as Array<{
    id: string;
    secret?: unknown;
  }>;
  expect(list.map((w) => w.id)).toContain(created.id);
  expect(list[0]?.secret).toBeUndefined();

  const eventTypes = (await (await fetch(`${base}/api/event-types`)).json()) as string[];
  expect(eventTypes).toContain("job.completed");
});

it("lists a running worker", async () => {
  const db = join(mkdtempSync(join(tmpdir(), "taskito-dash-")), "q.db");
  const queue = new Queue({ dbPath: db });
  queue.task("noop", () => null);
  const worker: Worker = queue.runWorker({ queues: ["default"] });
  const srv = serveDashboard(queue, { port: 0, staticDir });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const { port } = srv.address() as AddressInfo;

  try {
    const workers = (await (await fetch(`http://127.0.0.1:${port}/api/workers`)).json()) as Array<{
      pool_type: string;
      worker_id: string;
    }>;
    expect(workers.length).toBeGreaterThanOrEqual(1);
    expect(workers[0]?.pool_type).toBe("node");
    expect(typeof workers[0]?.worker_id).toBe("string");
  } finally {
    worker.stop();
    srv.close();
  }
});

it("aggregates metrics after a job completes", async () => {
  const db = join(mkdtempSync(join(tmpdir(), "taskito-dash-")), "q.db");
  const queue = new Queue({ dbPath: db });
  queue.task("add", (a: number, b: number) => a + b);
  const id = queue.enqueue("add", [2, 3]);
  const worker: Worker = queue.runWorker();
  const srv = serveDashboard(queue, { port: 0, staticDir });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const { port } = srv.address() as AddressInfo;

  try {
    await queue.result(id);
    let metrics: Record<string, { count: number; success_count: number }> = {};
    for (let i = 0; i < 60 && metrics.add === undefined; i++) {
      metrics = (await (
        await fetch(`http://127.0.0.1:${port}/api/metrics?since=3600`)
      ).json()) as Record<string, { count: number; success_count: number }>;
      if (metrics.add === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    expect(metrics.add?.count).toBeGreaterThanOrEqual(1);
    expect(metrics.add?.success_count).toBeGreaterThanOrEqual(1);
  } finally {
    worker.stop();
    srv.close();
  }
});
