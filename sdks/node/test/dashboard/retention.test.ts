import { execSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedAdminAndSession } from "../../src/dashboard/testing";
import { Queue, serveDashboard } from "../../src/index";

const pkgRoot = fileURLToPath(new URL("../..", import.meta.url));
const staticDir = join(pkgRoot, "static", "dashboard");
const DAY_MS = 86_400_000;

// The document the elected cleaner publishes — see `BINDING_CONTRACT.md`.
const PUBLISHED_KEY = "retention:effective:default";
const published = JSON.stringify({
  enabled: true,
  defaulted: true,
  namespace: "default",
  reported_at: 1_753_200_000_000,
  windows: {
    archived_jobs_ttl_ms: 7 * DAY_MS,
    dead_letter_ttl_ms: 30 * DAY_MS,
    task_logs_ttl_ms: 3 * DAY_MS,
    task_metrics_ttl_ms: 7 * DAY_MS,
    job_errors_ttl_ms: null,
  },
});

beforeAll(() => {
  if (!existsSync(join(staticDir, "index.html"))) {
    execSync("pnpm run build:dashboard", { cwd: pkgRoot, stdio: "ignore" });
  }
}, 120_000);

let server: Server | undefined;
let queue: Queue;
let base = "";
let headers: Record<string, string> = {};

beforeEach(async () => {
  const db = join(mkdtempSync(join(tmpdir(), "taskito-retention-")), "q.db");
  queue = new Queue({ dbPath: db });
  ({ headers } = await seedAdminAndSession(queue));
  server = serveDashboard(queue, { port: 0, staticDir, secureCookies: false });
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server?.close();
  server = undefined;
});

const get = async (path: string) =>
  (await (await fetch(`${base}${path}`, { headers })).json()) as Record<string, never>;

describe("effectiveRetention", () => {
  it("is null until a cleaner publishes", () => {
    // Unreported is not "off": no worker has swept, so nothing is known yet.
    expect(queue.effectiveRetention()).toBeNull();
  });

  it("parses the published document", () => {
    queue.setSetting(PUBLISHED_KEY, published);

    expect(queue.effectiveRetention()).toEqual({
      enabled: true,
      defaulted: true,
      namespace: "default",
      reportedAt: 1_753_200_000_000,
      windows: {
        archivedJobs: 7 * DAY_MS,
        deadLetter: 30 * DAY_MS,
        taskLogs: 3 * DAY_MS,
        taskMetrics: 7 * DAY_MS,
        // A table with no window is kept forever, not purged.
        jobErrors: null,
      },
    });
  });
});

describe("retention api", () => {
  it("reports nothing before a sweep", async () => {
    const body = await get("/api/retention");

    expect(body.reported).toBe(false);
    expect(body.enabled).toBe(false);
    expect(body.namespace).toBeNull();
    expect(body.reported_at).toBeNull();
    expect(body.windows).toEqual({
      task_logs_ttl_ms: null,
      archived_jobs_ttl_ms: null,
      job_errors_ttl_ms: null,
      task_metrics_ttl_ms: null,
      dead_letter_ttl_ms: null,
    });
  });

  it("echoes the published windows", async () => {
    queue.setSetting(PUBLISHED_KEY, published);

    const body = await get("/api/retention");

    expect(body.reported).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.defaulted).toBe(true);
    expect(body.namespace).toBe("default");
    expect(body.reported_at).toBe(1_753_200_000_000);
    expect(body.windows).toEqual({
      task_logs_ttl_ms: 3 * DAY_MS,
      archived_jobs_ttl_ms: 7 * DAY_MS,
      job_errors_ttl_ms: null,
      task_metrics_ttl_ms: 7 * DAY_MS,
      dead_letter_ttl_ms: 30 * DAY_MS,
    });
  });

  it("keeps the published policy out of the settings api", async () => {
    queue.setSetting(PUBLISHED_KEY, published);

    // A report of what the worker does, not a knob: never listed as an
    // editable row, never spoofable through the generic KV endpoints.
    expect(Object.keys(await get("/api/settings"))).not.toContain(PUBLISHED_KEY);
    expect((await fetch(`${base}/api/settings/${PUBLISHED_KEY}`, { headers })).status).toBe(404);

    const spoof = await fetch(`${base}/api/settings/${PUBLISHED_KEY}`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ value: "{}" }),
    });
    expect(spoof.status).toBe(400);
  });
});
