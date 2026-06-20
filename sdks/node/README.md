# taskito (Node.js)

Rust-powered task queue for Node.js — no broker required. A thin
[napi-rs](https://napi.rs) shell over the Taskito Rust core, peer to the Python
SDK. Enqueue work and run workers in the same process or across processes that
share storage (SQLite, PostgreSQL, or Redis).

## Install

```bash
pnpm add taskito
```

Requires Node.js >= 18. Ships as dual ESM + CommonJS.

## Quickstart

```ts
import { Queue } from "taskito";

const queue = new Queue({ dbPath: "taskito.db" });

// Register a task with optional per-task config.
queue.task("add", (a: number, b: number) => a + b, {
  maxRetries: 3,
  retryBackoff: { baseMs: 1000, maxMs: 60_000 },
  timeoutMs: 30_000,
  maxConcurrent: 4,
  circuitBreaker: { threshold: 5, windowMs: 60_000, cooldownMs: 30_000 },
});

// Producer.
const id = queue.enqueue("add", [2, 3], { priority: 5 });

// Worker.
const worker = queue.runWorker({ queues: ["default"] });

// Await the result.
const result = await queue.result(id); // 5
worker.stop();
```

## Backends

```ts
new Queue({ dbPath: "taskito.db" });                      // SQLite (default)
new Queue({ backend: "postgres", dsn: process.env.PG_URL, schema: "taskito" });
new Queue({ backend: "redis", dsn: "redis://localhost", prefix: "taskito" });
```

## Enqueue options

`priority`, `maxRetries`, `timeoutMs`, `delayMs` (delayed run), `uniqueKey`
(idempotency — a duplicate enqueue is a no-op while the first job is
pending/running), `metadata`, `namespace`.

## Cancellation

Cancellation is cooperative. A running task reads its context via `currentJob()`:

```ts
import { currentJob } from "taskito";

queue.task("download", async (url: string) => {
  const { signal } = currentJob() ?? {};
  const res = await fetch(url, { signal });
  return res.text();
});

queue.requestCancel(jobId); // aborts the task's signal
```

`cancelJob(id)` cancels a still-pending job. Tasks may report progress via
`currentJob()?.setProgress(0–100)`.

## Inspection & management

```ts
queue.stats();              // { pending, running, completed, failed, dead, cancelled }
queue.statsByQueue("default");
queue.statsAllQueues();
queue.listJobs({ status: "failed", limit: 50 });
queue.getJobErrors(id);
queue.getMetrics(3600_000, "add");

queue.deadLetters();        // dead-letter entries
queue.retryDead(deadId);    // re-enqueue
queue.deleteDead(deadId);
queue.purgeDead(olderThanMs);
queue.purgeCompleted(olderThanMs);

queue.pauseQueue("default");
queue.resumeQueue("default");
queue.listPausedQueues();
```

## Serializers

Args and results are serialized with a pluggable `Serializer` (default
`JsonSerializer`; `MsgpackSerializer` for compact binary). The Rust core treats
payloads as opaque bytes.

```ts
import { Queue, MsgpackSerializer } from "taskito";
new Queue({ dbPath: "taskito.db", serializer: new MsgpackSerializer() });
```

## CLI

A standalone `taskito` command (no Python) operates the queue from the terminal:

```bash
# Connect with --db <path> (or --backend/--dsn for postgres/redis).
taskito --db taskito.db enqueue add '[2,3]'
taskito --db taskito.db stats
taskito --db taskito.db jobs --status failed
taskito --db taskito.db dlq list
taskito --db taskito.db dlq retry <deadId>
taskito --db taskito.db pause default
taskito --db taskito.db cancel <jobId>

# Run a worker from a module that exports a configured Queue.
taskito run ./app.js --queues default,emails
```

`--json` on any read command prints machine-readable output.

## Events & middleware

Subscribe to job lifecycle events, or register middleware around execution:

```ts
queue.on("job.completed", (e) => console.log("done", e.jobId));
queue.on("job.dead", (e) => alertOps(e));

queue.use({
  before: (ctx) => log.info("start", ctx.taskName),
  after: (ctx, result) => log.info("ok", ctx.taskName),
  onError: (ctx, err) => log.error("threw", ctx.taskName, err),
  onRetry: (e) => metrics.inc("retry", e.taskName),
  onDeadLetter: (e) => alertOps(e),
});
```

Events: `job.completed`, `job.retrying`, `job.dead`, `job.cancelled`. `before`/
`after`/`onError` wrap execution (awaited); the outcome hooks fire after the core
decides the result.

## Distributed locks

TTL-bounded, owner-scoped locks backed by the queue's storage — coordinate
across processes without a separate lock server. A held lock auto-extends at
`ttlMs / 3` so a slow section never loses it.

```ts
// Scoped helper — acquires, runs, releases (throws if held elsewhere).
await queue.withLock("report:2026-06", async () => {
  await rebuildReport();
});

// Manual handle, or `using` for automatic release.
using lock = queue.lock("resource", { ttlMs: 30_000 });
if (lock.acquire()) {
  // ... critical section
} // released at block exit
```

`lock.extend(ms)`, `lock.info()`, and `lock.ownerId` round out the API. Expired
locks are reaped by the worker's maintenance loop.

## Periodic (cron) tasks

Schedule a registered task on a cron expression. A running worker enqueues it
when due (the scheduler's maintenance loop drives this).

```ts
queue.task("digest", (date: string) => sendDigest(date));

// cron is 6/7-field, seconds first: sec min hour day-of-month month day-of-week
queue.registerPeriodic("daily-digest", "digest", "0 0 9 * * *", {
  args: ["2026-06-16"],
  timezone: "America/New_York",
});
```

Returns the next fire time (Unix ms). Re-registering the same name replaces it.

## Webhooks

Deliver job events to HTTP endpoints — HMAC-SHA256 signed, retried with backoff,
persisted across restarts:

```ts
const hook = queue.webhooks.create({
  url: "https://hooks.example.com/jobs",
  events: ["job.dead", "job.completed"], // omit for all
  secret: process.env.WEBHOOK_SECRET,    // signs X-Taskito-Signature: sha256=...
  taskFilter: ["send_email"],            // optional
});

queue.webhooks.list();
queue.webhooks.delete(hook.id);
```

Deliveries fire from the worker process (where events originate). The dashboard
exposes `/api/webhooks` for managing them.

## Workflows

Orchestrate multi-step DAGs. Each step is a registered task; `after` declares
dependencies. Steps are pre-enqueued with `depends_on` chains, so the core
scheduler runs them in topological order — and a worker advances the run as each
step settles.

```ts
const handle = queue.workflows
  .define("etl")
  .step("extract", "extractTask", { args: ["s3://bucket/in"] })
  .step("transform", "transformTask", { after: "extract" })
  .step("load", "loadTask", { after: "transform", maxRetries: 5 })
  .submit();

queue.runWorker(); // advances workflow nodes by default

const run = await handle.wait();      // resolves when terminal
console.log(run.state);               // "completed" | "failed" | ...
handle.nodes();                       // per-step status
queue.workflows.list({ state: "running" });
```

If a step dead-letters, the run fails and remaining steps are skipped
(fail-fast). Per-step options: `after`, `args`, `queue`, `maxRetries`,
`timeoutMs`, `priority`. Workers that never process workflow steps can skip the
per-job bookkeeping with `runWorker({ advanceWorkflows: false })`. Requires the
addon built with the `workflows` cargo feature (enabled by `build:native`).

Fan-out, gates, sub-workflows, and saga compensation are not yet bound — for
those, use the Python SDK.

## Dashboard

A web dashboard (the same React UI the Python SDK serves) runs over the queue —
no Python required. Build the SPA assets once, then serve:

```bash
pnpm build:dashboard          # builds the SPA into static/dashboard (one-time)
taskito --db taskito.db dashboard --port 8787
```

Or programmatically:

```ts
import { Queue, serveDashboard } from "taskito";

const queue = new Queue({ dbPath: "taskito.db" });
const server = serveDashboard(queue, { port: 8787 });
// ... server.close() to stop
```

It serves the SPA plus the `/api/*` REST contract (stats, jobs, dead-letters,
queues, metrics, workers, webhooks, workflow runs, cancel/retry/pause/resume)
over the queue. Auth runs open (localhost); the metrics and workers panels
populate from live job history and running workers.

## Mesh (work-stealing overlay)

Workers can form a decentralized mesh — SWIM gossip for peer discovery plus
consistent-hash placement and TCP work-stealing — so idle nodes pull work from
busy ones. The database stays the source of truth; the mesh only optimizes
dispatch locality. Requires the addon built with the `mesh` cargo feature
(`build:native` enables it).

```ts
queue.runWorker({
  queues: ["default"],
  mesh: {
    port: 7946,                       // UDP gossip; TCP steal binds port + 1
    seeds: ["10.0.0.2:7946"],         // peers to join (empty = standalone)
    steal: true,
    encryptionKey: process.env.MESH_KEY, // optional XOR-encrypt gossip
  },
});
```

Other tunables: `bindAddr`, `advertiseAddr` (NAT), `affinityWeight`,
`localBuffer`, `stealBatch`, `stealThreshold`, `virtualNodes`, `stealRateLimit`.

## Development

```bash
pnpm install
pnpm build       # napi build (native addon) + tsup (dual esm/cjs + .d.ts)
pnpm typecheck
pnpm lint
pnpm test
```

The native crate lives at `crates/taskito-node`; this package builds it into
`native/` and wraps it with a typed TypeScript API. Postgres/Redis backends are
compiled in via `--features postgres,redis`.

## Not yet covered

Advanced workflow features (fan-out, gates, sub-workflows, saga compensation),
resources/proxies/interception, contrib integrations, prebuilt platform binaries +
npm publish (host-only build for now), and Python⇄Node cross-language interop.
