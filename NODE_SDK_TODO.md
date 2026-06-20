# Node SDK — Parity TODO & Status

Living plan for the **Node.js SDK** (`crates/taskito-node` napi-rs crate + `sdks/node`
TS package). Goal: a fully standalone Node SDK with feature parity to the Python
SDK, zero Python dependency, over the shared Rust core.

- **Branch:** `feat/sdks-node` (local commits only — not pushed, no PRs yet).
- **Engine crates stay binding-agnostic:** `taskito-core`, `taskito-workflows`,
  `taskito-mesh` must never depend on `pyo3` or `napi`. Enforced by a `cargo tree`
  tripwire in CI. The napi shell lives only in `crates/taskito-node`.
- **Tooling:** always `pnpm` (never npm/npx). Rust via `cargo`. Pre-commit hooks
  (`cargo fmt`, `cargo clippy`, biome) must pass — fix, don't bypass.

---

## Done

| Area | Commit(s) | Notes |
|------|-----------|-------|
| Production core | (earlier) | sqlite/postgres/redis backends, enqueue + idempotency, per-task retry/timeout/concurrency/rate-limit, cancellation, inspection/management, JSON + msgpack serializers |
| Worker lifecycle | `c8a9246`, `a77c592` | register + heartbeat (5s) + unregister; `list_workers`; dashboard workers panel |
| Outcomes → events | `5bf451e`, `3922a3e` | result-drain surfaces `ResultOutcome` to a JS callback; `Emitter` + `Middleware` |
| Events + middleware | `70d176e`, `704b4d8` | `job.completed/retrying/dead/cancelled`; before/after/onError + outcome hooks |
| Typed task registry | `7b4a057` | `Queue<TTasks>`, chainable `task()`, `enqueue` infers arg types; `RateLimit` template type |
| Settings KV | `f54f523` | get/set/delete/list settings |
| Webhooks | `1e09a08`, `174590c`, `755f66b`, `c3732e1`, `fc8a67e` | KV-persisted store, HMAC-SHA256 signed delivery + retries, `WebhookManager`, dashboard endpoints |
| CLI | (earlier) | standalone `taskito` bin: enqueue/stats/jobs/dlq/queues/cancel/run/dashboard |
| Dashboard | (earlier) | serves the **existing React SPA** + `/api/*` snake_case contract + open-auth stub; metrics + workers panels |
| **Mesh** | `bb20625` | `mesh` cargo feature; `MeshWorkerConfig` on `runWorker`; `run_mesh_bridge` in `worker.rs` |
| **Workflows (DAG v1)** | `4927a03` | submit/advance/query; core sequences via `depends_on`; TS builder DSL + `queue.workflows` |
| **Logger** | `228d16b` | `src/utils/logger.ts` — leveled, lazy thunks, namespaced children, pluggable sink |
| **Dashboard workflows panel** | `1be346b` | 4 GET endpoints serving the SPA workflows page |
| **Distributed locks** | `0655349` | `queue.lock` / `queue.withLock`, auto-extend, `Symbol.dispose` |
| **Periodic + circuit-breaker** | `a4cc9a4` | `queue.registerPeriodic`; per-task `circuitBreaker` config |

**Verify everything green:**
```bash
cargo clippy -p taskito-node --features postgres,redis,mesh,workflows -- -D warnings
cargo check -p taskito-node                          # default build (mesh/workflows off)
cd sdks/node && pnpm run build:native && pnpm typecheck && pnpm lint && pnpm test   # 48 tests
```
`build:native` ships `--features postgres,redis,mesh,workflows`.

---

## Left to do

Ordered roughly by value / tractability.

### 1. Resources / proxies / interception (Node-native equivalents) — LARGE

Python has a worker dependency-injection runtime (`resources/`), transparent
non-serializable-object handling (`proxies/`), and argument interception
(`interception/`). These are **Python-idiom-specific** (decorators, cloudpickle,
context managers) — do **not** port 1:1. Design Node-native equivalents:

- **Resources / DI:** a `queue.resource(name, factory, { scope })` registry with
  scopes (worker / task / request); inject into handlers via a context accessor
  (extend `context.ts` / `AsyncLocalStorage`) or an explicit `deps` argument.
- **Proxies:** likely unnecessary in Node — JS has no pickle problem. Handlers
  close over their own resources. Skip unless a concrete need appears.
- **Interception:** argument validation / redaction hook before serialization in
  `Queue.enqueue`. Could be a lightweight middleware-style `beforeEnqueue` hook.

**Where:** new `sdks/node/src/resources/`; touch `worker.ts` (inject), `context.ts`.
**Effort:** large (design-heavy). **Recommendation:** scope a minimal resource DI
first (worker-scoped singletons + task-scoped factories); defer proxies entirely.

### 2. Contrib integrations — MEDIUM

Python ships `contrib/` (OpenTelemetry, Sentry, Prometheus, Flask, Django,
FastAPI). Node equivalents:

- **Observability:** OpenTelemetry (`@opentelemetry/api`), Prometheus
  (`prom-client`) — implement as middleware over the existing events/middleware
  layer (`src/middleware.ts`). Each = a `Middleware` that records spans/metrics.
- **Web frameworks:** Express / Fastify / Nest helpers (enqueue from a request,
  mount the dashboard). Python's Flask/Django/FastAPI map to these.

**Where:** new `sdks/node/src/contrib/` (one file per integration, optional peer
deps). **Effort:** medium. Each integration is small and independent → **one
commit each**.

### 3. Advanced workflow features — LARGE

DAG/linear workflows work (v1). Still unbound: **fan-out, gates/conditions,
sub-workflows, saga compensation**. These are **deferred** in the Python engine
too — they are NOT in the `taskito-workflows` crate; they live in
`crates/taskito-python/src/py_queue/workflow_ops/{fan_out,gates,saga}.rs` plus a
Python `WorkflowTracker` that reacts to job events and enqueues nodes on-demand.

**To bind:** port that on-demand orchestration into `taskito-node` (the tracker
brain), driven from the worker outcome callback (already wired for v1
advancement). Fan-out = expand N child nodes at runtime; gates = pause/approve;
saga = run compensation jobs on failure in reverse order.

**Where:** extend `crates/taskito-node/src/queue/workflows.rs` + `src/workflows/`.
**Effort:** large. **Recommendation:** fan-out first (most-requested), then gates,
then saga. Each is a separate feature/commit.

### 4. Dashboard workflows DAG panel completeness — SMALL

The 4 workflow endpoints exist; `/runs/:id/dag` returns the `SerializableGraph`
JSON. Verify the SPA's DAG **visualizer** renders it correctly against Node-shaped
data, and that `/runs/:id/children` is correct once sub-workflows exist (#3).
Currently children is always `[]` for Node-submitted runs.

**Where:** `sdks/node/src/dashboard/{handlers,contract,routes}.ts`. **Effort:** small.

### 5. Prebuilt platform matrix + npm publish — MEDIUM (infra)

Today `build:native` is **host-only** (builds for the current platform). For npm:

- Build prebuilt `.node` binaries per platform/arch (linux x64/arm64, macOS
  x64/arm64, win x64) via `@napi-rs/cli` + CI matrix (GitHub Actions).
- napi-rs `optionalDependencies` per-platform package pattern, OR bundle prebuilds.
- npm publish workflow (mirror the Python `publish.yml`; OIDC / token).
- Decide package name + scope.

**Where:** `.github/workflows/`, `sdks/node/package.json` (`napi` config, `files`,
`optionalDependencies`). **Effort:** medium, mostly CI plumbing.

### 6. Python⇄Node interop — OPTIONAL (deferred)

Cross-language jobs over **shared storage** (Python enqueues → Node worker runs,
and vice versa). **Not required for the standalone goal** — only matters for
mixed-language deployments on one DB.

**Already partially free:** core + storage + metadata/notes/workflow tables are
shared. A Python task with **positional-only args + JSON/msgpack** serializer is
runnable by a Node worker today (if the task name is registered both sides) —
**unverified**.

**Blockers:**
- Python default serializer = **cloudpickle** → opaque to Node. Interop forces
  JSON/msgpack on both sides.
- **kwargs mismatch:** Python args = `(args tuple, kwargs dict)`; Node = positional
  array, no kwargs. Need a shared payload envelope (e.g. msgpack `{args, kwargs}`).

**Three options (decision pending):**
- `defer` — skip until a mixed deployment is actually needed (recommended).
- `verify-doc-only` — write interop tests for the simple JSON-positional case,
  document which codecs/arg-shapes interop, ship that as the contract.
- `full-interop` — define + implement the cross-lang msgpack envelope (args +
  kwargs), Node (de)serializer for it, interop tests across all 3 backends, docs.

**Effort:** verify-doc-only = small; full-interop = medium.

---

## Docs site — decision: **hybrid** (not yet built)

Current docs (`docs/`, Fumadocs / Next.js 16) are **100% Python**, reference stale
`py_src` paths (51 files), have no `sdks/` section and no Node mention.

**Chosen structure (hybrid):**
- `concepts/` — language-neutral (Rust core, storage, scheduler, mesh, workflow
  engine, capabilities, glossary). Cross-cutting code samples use **tabbed
  Python/Node snippets** (`<Tabs groupId="sdk" persist>`).
- `python/` — full Python SDK tree (relocate current pages; fix the 51 stale refs).
- `node/` — full Node SDK tree (author from `sdks/node/README.md` + feature pages:
  tasks, workers, cancellation, serializers, events+middleware, webhooks, locks,
  workflows, mesh, periodic, cli, dashboard).
- `more/` — changelog, upgrading, contributing.

**Single URL:** one Fumadocs deploy. SDK = path segment (`/docs/python/...`,
`/docs/node/...`). Fumadocs **root-folder sidebar tabs** (`"root": true` in each
SDK folder's `meta.json`) give a Python↔Node switch. No subdomains, no separate
sites. Landing page: pick Python | Node.

**Why hybrid (not pure A/B):** the two SDK APIs diverge hard (Python decorators /
resources / proxies / interception vs Node typed registry / chainable builder /
`using` locks), so per-SDK trees avoid litter of "X only" callouts; neutral
concepts written once with tabs where code is genuinely parallel.

**Migration steps:** (1) `concepts/` ← move `architecture/` + `capabilities`;
(2) `python/` ← relocate current pages, fix stale `py_src` refs; (3) `node/` ←
author new; (4) root `meta.json` order + landing SDK pick.

---

## Key technical facts / gotchas

- **DAG bytes = plain JSON** of `dagron_core::SerializableGraph`:
  `{nodes:[{name}], edges:[{from,to,weight}]}`. Built directly in TS — no
  DAG-builder binding needed. `taskito_workflows::topological_order` is `pub`.
- **Workflow advancement** rides the worker **outcome callback**
  (`queue.markWorkflowNodeResult` on success/dead). For DAGs the **core scheduler
  sequences nodes via `depends_on`** — no Python-style tracker for the happy path.
  Fan-out/gates/saga need a real tracker (see #3).
- **Cron = `cron` crate format: 6/7-field, seconds first** —
  `sec min hour day-of-month month day-of-week [year]`. NOT 5-field. e.g. hourly =
  `0 0 * * * *`.
- **Periodic dispatch already runs** in the worker maintenance loop (so a Node
  worker fires periodic tasks automatically); only registration is bound.
- **Lock auto-extend** uses an unref'd `setInterval` at `ttlMs/3`; `Lock`
  implements `Symbol.dispose` so `using lock = queue.lock(...)` works.
- **napi cross-dir build:** `napi build --platform --release --cargo-cwd
  ../../crates/taskito-node --features ... native`. Generated `native/index.js` is
  CJS (nested `native/package.json` = `{"type":"commonjs"}`); loaded via runtime
  `createRequire` + `new URL` so tsup leaves it external.
- **Feature gating:** `workflows` + `mesh` are cargo features (optional deps).
  `postgres`/`redis` wire workflow-crate features via weak deps
  (`taskito-workflows?/postgres`). Locks/periodic/circuit-breaker are **ungated**
  (core storage).
- **Dashboard serves the existing React SPA** (`dashboard/`), built to
  `sdks/node/static/dashboard` via `pnpm build:dashboard`. SPA expects
  **snake_case** + Unix-ms; `dashboard/contract.ts` maps camelCase → snake_case.

---

## Build / verify reference

```bash
# Rust
cargo clippy -p taskito-node --features postgres,redis,mesh,workflows -- -D warnings
cargo check  -p taskito-node                          # default (no mesh/workflows)
cargo check  -p taskito-node --features workflows     # weak-dep sanity
# crate purity tripwire (must print nothing):
cargo tree -p taskito-workflows -e normal | grep -iE 'pyo3|napi'
cargo tree -p taskito-mesh      -e normal | grep -iE 'pyo3|napi'

# Node (from sdks/node/)
pnpm run build:native      # napi build, all features
pnpm run build:ts          # tsup dual ESM/CJS + .d.ts
pnpm typecheck             # tsc --noEmit (includes test/)
pnpm lint                  # biome
pnpm test                  # vitest (48 tests)
pnpm run build:dashboard   # build the React SPA into static/dashboard
```

---

## File map (Node SDK)

```
crates/taskito-node/src/
  lib.rs            backend.rs  dispatcher.rs  worker.rs  error.rs  config.rs
  queue/{mod,inspect,admin,locks,periodic,workflows}.rs
  convert/{mod,job,stats,outcome,task_config,lock,workflow}.rs

sdks/node/src/
  index.ts native.ts queue.ts worker.ts context.ts errors.ts types.ts
  utils/{logger,index}.ts
  locks/{lock,types,index}.ts
  workflows/{builder,manager,types,index}.ts
  webhooks/{store,deliverer,manager,types,index}.ts
  serializers/{serializer,json,msgpack,index}.ts
  dashboard/{server,routes,handlers,contract,static,metrics,api,index}.ts
  cli/{index,connect,output,commands/*}.ts
sdks/node/test/*.test.ts        # 15 files, 48 tests
```

Memory: see `.claude/memory/session-history.md` (Node SDK section) for the running
log of decisions.
