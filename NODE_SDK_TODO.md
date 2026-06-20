# Node SDK — Parity TODO & Status

Living plan for the **Node.js SDK** (`crates/taskito-node` napi-rs crate + `sdks/node`
TS package). Goal: a fully standalone Node SDK with feature parity to the Python
SDK, zero Python dependency, over the shared Rust core.

- **Branch:** landing as a sequence of focused PRs off `master` (see `tasks/branch-split-plan.md`).
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
| **Workflows: fan-out / fan-in** | (this branch) | TS `WorkflowTracker` brain (`src/workflows/tracker.ts`) driven by the outcome callback; `.fanOut()` / `.fanIn()` builder steps; napi primitives `expandFanOut`/`checkFanOutCompletion`/`createDeferredJob`/`finalizeRunIfTerminal`/`getWorkflowRunPlan`/`workflowNodeForJob`/`cascadeSkipPending`; deferred-node submit. Storage-reconstructable (no submit-time registration) |
| **Dashboard DAG completeness** | (this branch) | `JsWorkflowNode` carries `fanOutCount` + `compensation_*`; `/dag` handler enriches the raw graph with per-node `deps[]` + live `status` + job-id `id` so the SPA visualizer renders edges/colours/links |
| **Contrib integrations** | (this branch) | `src/contrib/{otel,prometheus,express,fastify,nest,sentry}.ts` — each an optional subpath export (`taskito/contrib/*`) with an optional peer dep. OTel + Prometheus + Sentry = `Middleware` over the events layer; Express/Fastify = REST router (shared `rest.ts` table) + dashboard mount (via extracted `createDashboardHandler`); Nest = `TaskitoModule.forRoot` + injectable `TaskitoService`. 17 new vitest tests |

**Verify everything green:**
```bash
cargo clippy -p taskito-node --features postgres,redis,mesh,workflows -- -D warnings
cargo check -p taskito-node                          # default build (mesh/workflows off)
cd sdks/node && pnpm run build:native && pnpm typecheck && pnpm lint && pnpm test   # full Node suite
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

### 2. Contrib integrations — DONE

Shipped: OpenTelemetry + Prometheus + Sentry middleware, Express + Fastify (REST router +
dashboard mount), and a NestJS module
(`src/contrib/{otel,prometheus,sentry,express,fastify,nest}.ts`). Each is an optional
`taskito/contrib/*` subpath export with an optional peer dependency, its own tsup entry,
and tests. The REST logic is shared via a framework-neutral `src/contrib/rest.ts` route
table; the dashboard mount reuses `createDashboardHandler` (extracted from
`dashboard/server.ts`). NestJS uses an explicit `@Inject(TASKITO_QUEUE)` token to avoid
relying on esbuild decorator-metadata emission (`experimentalDecorators` on; biome
`unsafeParameterDecoratorsEnabled`). Sentry captures the real exception from `onError`
and reports it on dead-letter (one event/dead job), optional per-retry warnings.

### 3. Advanced workflow features — LARGE (fan-out DONE; gates / sub-workflows / saga remain)

DAG/linear + **fan-out / fan-in** work. The tracker-brain foundation is built:
a TS `WorkflowTracker` (`src/workflows/tracker.ts`) reacts to the worker outcome
callback, reconstructs the run plan from storage (DAG + step metadata — no
submit-time registration), and drives on-demand orchestration via napi
primitives (`expandFanOut`, `checkFanOutCompletion`, `createDeferredJob`,
`finalizeRunIfTerminal`, `getWorkflowRunPlan`, `workflowNodeForJob`,
`cascadeSkipPending`). `submit_workflow` takes `deferredNodeNames` (fan-out /
fan-in ∪ descendants get a node but no static job). Failures are fail-fast.

**Still unbound: gates/conditions, sub-workflows, saga compensation.** They build
on this same foundation (the Python references are
`crates/taskito-python/src/py_queue/workflow_ops/{gates,saga}.rs` + the Python
`WorkflowTracker`):
- **gates/conditions** — a deferred node enters `waiting_approval`; resolve via a
  new `resolveWorkflowGate` napi method + a JS-side timer (`setTimeout`) for
  timeouts. Conditions = a `should_execute` check in `evaluateSuccessors`.
- **sub-workflows** — extend `submit_workflow` with `parent_run_id` /
  `parent_node_name`; the tracker submits a child run for a sub-workflow node and
  resolves the parent node when the child finalizes (populates `/children`).
- **saga** — reverse-topo compensation waves driven by the tracker; needs the
  `setWorkflowNodeCompensation*` + run-state napi setters bound (storage methods
  already exist on the `WorkflowStorage` trait).

**Where:** `crates/taskito-node/src/queue/workflows.rs` + `src/workflows/tracker.ts`.
**Effort:** medium each now the brain exists. Each is a separate feature/commit.

### 4. Dashboard workflows DAG panel completeness — DONE

`JsWorkflowNode` now carries `fanOutCount` + `compensation_*`; `contract.ts` maps
them (saga fields stay null until saga is bound). The `/runs/:id/dag` handler
(`dashboard/handlers.ts::enrichDag`) rewrites the raw `SerializableGraph` into the
shape the SPA visualizer actually consumes — per-node `deps[]` (from edges), live
`status` (merged from the nodes list), and `id` = job id for correct `/jobs/$id`
links — so the DAG tab renders real edges, colours, and links. `/runs/:id/children`
stays `[]` until sub-workflows exist (#3).

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
pnpm test                  # vitest (69 tests)
pnpm run build:dashboard   # build the React SPA into static/dashboard
```

---

## File map (Node SDK)

```text
crates/taskito-node/src/
  lib.rs            backend.rs  dispatcher.rs  worker.rs  error.rs  config.rs
  queue/{mod,inspect,admin,locks,periodic,workflows}.rs
  convert/{mod,job,stats,outcome,task_config,lock,workflow}.rs

sdks/node/src/
  index.ts native.ts queue.ts worker.ts context.ts errors.ts types.ts
  utils/{logger,index}.ts
  locks/{lock,types,index}.ts
  workflows/{builder,manager,tracker,plan,types,index}.ts
  webhooks/{store,deliverer,manager,types,index}.ts
  serializers/{serializer,json,msgpack,index}.ts
  dashboard/{server,routes,handlers,contract,static,metrics,api,index}.ts
  contrib/{otel,prometheus,sentry,express,fastify,nest,rest}.ts   # optional subpath exports
  cli/{index,connect,output,commands/*}.ts
<<<<<<< HEAD
sdks/node/test/*.test.ts        # grouped by feature area
=======
sdks/node/test/*.test.ts        # 22 files, 69 tests
>>>>>>> 9394bcb (docs(node): document Sentry contrib middleware)
```

Memory: see `.claude/memory/session-history.md` (Node SDK section) for the running
log of decisions.
