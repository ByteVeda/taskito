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

Workflows, mesh, middleware/events, distributed locks, periodic/cron tasks,
prebuilt platform binaries + npm publish (host-only build for now), and
Python⇄Node cross-language interop.
