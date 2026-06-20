# taskito (Node.js)

Rust-powered task queue for Node.js — no broker required. A thin
[napi-rs](https://napi.rs) shell over the Taskito Rust core, peer to the Python
SDK. SQLite-backed; enqueue work and run workers in the same process or across
processes sharing the database.

> **Status: early.** This is the first vertical slice — enqueue, a worker that
> runs JavaScript tasks, and result read-back over SQLite with a JSON
> serializer. See [Roadmap](#roadmap) for what is intentionally not here yet.

## Install

```bash
pnpm add taskito
```

Requires Node.js >= 18.

## Quickstart

```ts
import { Queue } from "taskito";

const queue = new Queue({ dbPath: "taskito.db" });

// Register a task (runs on the worker side).
queue.task("add", (a: number, b: number) => a + b);

// Producer: enqueue work.
const id = queue.enqueue("add", [2, 3]);

// Worker: process jobs. Tasks may be async.
const worker = queue.runWorker({ queues: ["default"] });

// Read the result back.
const result = queue.getResult(id); // 5 (once complete)

worker.stop();
```

## Serialization

Args and results are serialized with a pluggable `Serializer` (default
`JsonSerializer`). The Rust core treats payloads as opaque bytes. Cross-language
jobs (e.g. Python ⇄ Node) require both sides to use a matching neutral
serializer — JSON today, msgpack later.

```ts
import { Queue, type Serializer } from "taskito";

const queue = new Queue({ dbPath: "taskito.db", serializer: myMsgpackSerializer });
```

## Development

```bash
pnpm install
pnpm build       # napi build (native addon) + tsc (dist/)
pnpm typecheck
pnpm lint
pnpm test
```

The native crate lives at `crates/taskito-node`; this package builds it into
`native/` and wraps it with a typed TypeScript API.

## Roadmap

Deferred from this slice: PostgreSQL/Redis backends, workflows, mesh,
middleware/events, retry/rate-limit/concurrency configuration, cancellation,
prebuilt platform binaries + npm publish (host-only build for now), and
Python⇄Node cross-language interop.
