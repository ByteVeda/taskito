import { execSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { Queue, serveDashboard } from "../../src/index";

const pkgRoot = fileURLToPath(new URL("../..", import.meta.url));
const staticDir = join(pkgRoot, "static", "dashboard");
const TOKEN = "s3cret-token";

beforeAll(() => {
  if (!existsSync(join(staticDir, "index.html"))) {
    execSync("pnpm run build:dashboard", { cwd: pkgRoot, stdio: "ignore" });
  }
}, 120_000);

let server: Server | undefined;
let base = "";

beforeEach(async () => {
  const db = join(mkdtempSync(join(tmpdir(), "taskito-dashauth-")), "q.db");
  const queue = new Queue({ dbPath: db });
  queue.task("add", (a: number, b: number) => a + b);
  server = serveDashboard(queue, { port: 0, staticDir, auth: { token: TOKEN } });
  await new Promise((resolve) => setTimeout(resolve, 80));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server?.close();
  server = undefined;
});

it("rejects an API request without a token", async () => {
  const res = await fetch(`${base}/api/stats`);
  expect(res.status).toBe(401);
});

it("rejects a wrong token", async () => {
  const res = await fetch(`${base}/api/stats`, { headers: { authorization: "Bearer nope" } });
  expect(res.status).toBe(401);
});

it("accepts a Bearer token", async () => {
  const res = await fetch(`${base}/api/stats`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(res.status).toBe(200);
});

it("accepts an X-Taskito-Token header", async () => {
  const res = await fetch(`${base}/api/stats`, { headers: { "x-taskito-token": TOKEN } });
  expect(res.status).toBe(200);
});

it("accepts a ?token= query and sets a session cookie", async () => {
  const res = await fetch(`${base}/api/stats?token=${TOKEN}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toContain("taskito_token=");
});

it("leaves /api/auth/status public", async () => {
  const res = await fetch(`${base}/api/auth/status`);
  expect(res.status).toBe(200);
});
