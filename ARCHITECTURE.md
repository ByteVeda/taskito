# Architecture

This document is the map a contributor reads **before** changing Taskito. It
explains how the codebase is layered, where each responsibility lives, the
boundaries you must not cross, and the ordered steps for the changes people make
most often.

It is deliberately *not* a tutorial on running Taskito (see the
[docs site](docs/content/docs/architecture/overview.mdx)) nor a build/test guide
(see [`CONTRIBUTING.md`](CONTRIBUTING.md)). Three audiences, three documents:

| Document | Audience | Answers |
|---|---|---|
| `docs/content/docs/architecture/*` | end users | *How does Taskito behave?* — job lifecycle, failure model, scheduler semantics |
| `CONTRIBUTING.md` | new contributors | *How do I build and test it?* |
| **`ARCHITECTURE.md`** (this file) | **contributors & maintainers** | ***How is the code organized, and where do I add things?*** |

---

## System at a glance

Taskito is a hybrid system: a Python API on top, a Rust engine underneath, with
[PyO3](https://pyo3.rs) as the only seam between them. Python owns ergonomics and
extensibility; Rust owns storage, scheduling, dispatch, rate limiting, and worker
management. The two layers communicate exclusively through the compiled
`taskito._taskito` extension module — **Python never reaches into Rust internals,
and Rust never imports Python types except at the PyO3 binding edge.**

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ PYTHON API SURFACE             py_src/taskito/                             │
│   Queue (app.py) = 15 mixins · async_support/ · CLI · serializers          │
│                                                                            │
│ FEATURE SUBSYSTEMS             (pure-Python, composed onto Queue)          │
│   interception/ resources/ proxies/ workflows/ contrib/                    │
│   batching/ autoscale/ prefork/ predicates/ dashboard/                     │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │  PyO3 (taskito._taskito)
┌─────────────────────────────────────┴──────────────────────────────────────┐
│ PYO3 BINDINGS                  crates/taskito-python/                      │
│   py_queue/ (PyQueue + workflow_ops) · async_worker · prefork bridge       │
├────────────────────────────────────────────────────────────────────────────┤
│ RUST CORE                      crates/taskito-core/                        │
│   scheduler/ (poll · dispatch · retry · reap · wake)                       │
│   worker.rs (WorkerDispatcher trait) · resilience/ · periodic.rs           │
├────────────────────────────────────────────────────────────────────────────┤
│ STORAGE                        crates/taskito-core/src/storage/            │
│   Storage trait (traits.rs) ──delegate!──▶ StorageBackend enum             │
│     ├─ sqlite/        ┐ shared logic in diesel_common/ macros              │
│     ├─ postgres/      ┘                                                    │
│     └─ redis_backend/   (own impl — no Diesel)                             │
└────────────────────────────────────────────────────────────────────────────┘

  WORKFLOWS    crates/taskito-workflows/ — separate crate, own schema & stores
               (SQLite · Postgres · Redis), surfaced via py_queue/workflow_ops/

  NATIVE ASYNC crates/taskito-async/ — optional native-async pool
```

The dependency arrows point **downward only**. `taskito-core` knows nothing about
Python or PyO3; `taskito-python` depends on `taskito-core`; the Python package
depends on the compiled extension. This acyclic shape is the property that keeps
the codebase changeable — guard it.

---

## Layers & responsibilities

### 1. Python API surface — `py_src/taskito/`

The user-facing object is `Queue` in `app.py`. It is intentionally thin: a
constructor, the core `enqueue` / `enqueue_many` path, and serializer/idempotency
helpers. Everything else is composed in through **15 focused mixins**, each owning
one slice of the surface:

| Mixin (`mixins/`) | Owns |
|---|---|
| `decorators.py` | `@task`, `@periodic`, task wrapping, hook registration |
| `inspection.py` | read-only job/queue inspection |
| `operations.py` | enqueue-adjacent operations, cancel, replay |
| `locks.py` | distributed locks |
| `lifecycle.py` | worker start/stop, pause/resume |
| `events.py` | event subscription/emit |
| `middleware_admin.py` | enable/disable middleware |
| `overrides.py` | per-task runtime overrides |
| `predicates.py` | exception-filter predicates |
| `resources.py` | resource (DI) registration |
| `runtime_config.py` | queue-level rate/concurrency limits |
| `settings.py` | misc queue settings |

Async is **physically confined** to `async_support/`. Every `a*` convenience
wrapper lives in `async_support/mixins.py::AsyncQueueMixin`; the dedicated event
loop, contextvars job context, async locks, and `run_maybe_async()` helper live
beside it. No `import asyncio` leaks into the sync layer — when a module boundary
forbids a top-level import, the code is split across modules rather than scoped
inline (see `JobResult(AsyncJobResultMixin)`).

**Must not know about:** Rust internals, specific storage backends, or the
PyO3 struct layout. It talks to `taskito._taskito` through its public surface only.

### 2. Feature subsystems — pure-Python packages

These are self-contained packages composed onto the Queue. Each is a leaf the API
layer depends on, not the reverse:

- `interception/` — argument interceptor (runs before serialization) + reconstructor
  (worker side). Strategies: PASS / CONVERT / REDIRECT / PROXY / REJECT.
- `proxies/` — deconstruct/reconstruct non-serializable objects (files, sessions,
  cloud clients) with HMAC signing, schema validation, path allowlists.
- `resources/` — worker-side dependency injection with four scopes
  (WORKER/TASK/THREAD/REQUEST), hot reload, and TOML config.
- `workflows/` — builder DSL, tracker, fan-out, sagas, gates (backed by the
  workflows crate).
- `contrib/` — optional integrations (`otel`, `sentry`, `prometheus`, `flask`,
  `fastapi`, `django/`). All support `task_filter` and custom prefixes/attributes.
- `batching/`, `autoscale/`, `prefork/`, `predicates/`, `dashboard/`.

### 3. PyO3 bindings — `crates/taskito-python/`

The translation layer. `py_queue/` holds `PyQueue` plus partial `#[pymethods]`
blocks split by concern (enabled by PyO3's `multiple-pymethods` feature):
`mod.rs`, `inspection.rs`, `worker.rs`, and `workflow_ops/` (lifecycle, nodes,
fan_out, gates, queries, saga). `async_worker.rs` drives the `AsyncWorkerPool`
with `spawn_blocking` + GIL management. This layer converts Python values to Rust
and back; it holds **no business logic**.

### 4. Rust core — `crates/taskito-core/`

The engine. `scheduler/` is split by concern — `poller.rs` (dequeue & dispatch),
`result_handler.rs` (outcome → retry/dead-letter/cancel), `maintenance.rs`
(reap/cleanup/periodic), `wake.rs` (opt-in push dispatch) — with `mod.rs` holding
config and the `run()` loop. `worker.rs` defines the `WorkerDispatcher` trait
(future-proofing for non-Python bindings). `resilience/`, `periodic.rs`,
`job.rs`, and `error.rs` round it out.

**Must not know about:** Python. Keep it that way — it's what lets the core be
tested in pure Rust and reused behind other language bindings.

### 5. Storage — `crates/taskito-core/src/storage/`

A `Storage` trait (`traits.rs`) with three backends behind a `StorageBackend`
enum wired up by a `delegate!`-style macro in `mod.rs`. The trick that keeps this
DRY: **shared Diesel logic lives in `diesel_common/` macros**
(`impl_diesel_job_ops!`, `impl_diesel_lock_ops!`, and siblings for dead-letter,
archival, logs, metrics, workers, migrations). SQLite and Postgres differ only in
a handful of backend-specific files (locking strategy, upsert). Redis is a
separate hand-written impl (`redis_backend/`, JSON values + sorted sets + Lua
scripts for atomicity) — no Diesel.

The large size of `diesel_common/jobs.rs` is **a feature, not a smell**: it is one
macro that erases SQLite/Postgres duplication. Don't "flatten" it into per-backend
copies.

### 6. Workflows crate — `crates/taskito-workflows/`

A separate crate with its own schema (`workflow_definitions`, `workflow_runs`,
`workflow_nodes`) and migration path, kept apart so workflow state evolves
independently of the job queue. It now ships stores for **all three backends** —
`sqlite_store.rs`, `postgres_store.rs`, `redis_store.rs` — selected at runtime via
the `WorkflowStorageBackend` enum (`workflow_ops/mod.rs::workflow_storage`), with
Postgres/Redis behind cargo features.

### 7. Native async — `crates/taskito-async/`

Optional (`native-async` feature). `NativeAsyncPool` dual-dispatches: async tasks
run on the Python event loop, sync tasks via `spawn_blocking`. `PyResultSender`
bridges the Python executor back to the Rust scheduler.

---

## Annotated folder structure

```text
py_src/taskito/
├── app.py                 # Queue: constructor + core enqueue path
├── mixins/                # 15 Queue mixins (one responsibility each)
├── async_support/         # ALL asyncio lives here (sync layer stays asyncio-free)
├── interception/          # argument interception pipeline
├── proxies/               # non-serializable object proxying
├── resources/             # worker-side DI (4 scopes, hot reload)
├── workflows/             # workflow DSL, tracker, sagas, fan-out
├── contrib/               # otel · sentry · prometheus · flask · fastapi · django
├── batching/ autoscale/ prefork/ predicates/ dashboard/
├── serializers.py task.py middleware.py events.py result.py   # core primitives
└── _taskito.pyi           # type stubs for the native module (keep in sync!)

crates/
├── taskito-core/          # engine — NO Python
│   └── src/
│       ├── scheduler/     # poller · result_handler · maintenance · wake
│       ├── storage/
│       │   ├── traits.rs           # the Storage trait
│       │   ├── mod.rs              # StorageBackend enum + delegate macro
│       │   ├── diesel_common/      # shared SQLite/Postgres macros (DRY)
│       │   ├── sqlite/ postgres/   # backend-specific deltas only
│       │   └── redis_backend/      # standalone, no Diesel
│       ├── worker.rs      # WorkerDispatcher trait
│       └── resilience/ periodic.rs job.rs error.rs
├── taskito-python/        # PyO3 bindings — the only Python↔Rust seam
│   └── src/py_queue/      # PyQueue + workflow_ops/
├── taskito-workflows/     # separate crate, own schema + 3 backend stores
└── taskito-async/         # optional native-async pool
```

---

## Dependency & boundary rules

These invariants are what make the codebase easy to change. Treat a PR that
violates one as a design regression, not a style nit.

1. **Dependencies point downward only.** Python → PyO3 → core → storage.
   `taskito-core` must not depend on `taskito-python` or any Python type.
2. **The PyO3 module is the only seam.** Python touches Rust solely via the public
   surface of `taskito._taskito`. No reaching into struct internals; update
   `_taskito.pyi` whenever the native surface changes.
3. **Asyncio is confined to `async_support/`** (plus the narrow, documented
   exceptions: `app.py` uses only `iscoroutinefunction`; `contrib/fastapi.py`).
   No inline `import asyncio` to dodge a boundary — split the module instead.
4. **Shared storage logic lives in `diesel_common/` macros**, never copy-pasted
   per backend. Backend files hold only genuine SQLite/Postgres/Redis differences.
5. **Locks are table-based, not advisory** — advisory locks are connection-scoped
   and interact badly with pooling.
6. **All three backends move together.** A storage change isn't done until SQLite,
   Postgres, and Redis all implement it (CI runs all three).

---

## Extension recipes — "where do I add X"

These are the ordered touch-points for the common changes. The skills under
`.claude/skills/` (`storage-impl`, `python-api`, `rust-python-check`) carry the
detailed versions.

### Add a Storage method
1. Declare it on the `Storage` trait — `storage/traits.rs`.
2. Implement shared logic in the relevant `diesel_common/` macro (covers SQLite +
   Postgres at once).
3. Add any backend-specific delta in `sqlite/` and `postgres/`.
4. Implement it for Redis in `redis_backend/`.
5. Wire it through the `delegate!` macro in `storage/mod.rs`.
6. Expose it via PyO3 in `crates/taskito-python/src/py_queue/`.
7. Add the signature to `py_src/taskito/_taskito.pyi`.
8. Test: a Rust test in `storage/sqlite/tests.rs` + the contract suite (runs
   against all three backends in CI).

### Add a Python feature / Queue method
- Find the mixin that owns the concern (`mixins/`) and add the method there — do
  **not** grow `app.py`. New concern → new mixin, composed onto `Queue`.
- Async counterpart (if any) goes in `async_support/mixins.py` as an `a*` wrapper.
- Test under the matching `tests/<area>/` subdirectory.

### Add a contrib integration
- New module under `contrib/` following the existing middleware shape: support
  `task_filter`, configurable prefixes/namespaces, and an extra-attributes
  callable. Keep instance-based state (no module-level singletons — see Prometheus).

### Add a serializer or proxy handler
- Serializer: implement the `Serializer` protocol (`serializers.py`); per-task use
  via `@queue.task(serializer=...)`.
- Proxy handler: implement the `ProxyHandler` protocol and register it
  (`proxies/`), following the built-in handlers in `proxies/handlers/`.

---

## Scaling guardrails & the rebuild decision

**Why the current design holds.** The codebase is large (≈24.5k LOC Python,
≈24.3k LOC Rust across ~300 files) but not heavy: no god-objects, an acyclic
dependency graph, a single well-defined Python↔Rust seam, and duplication erased
by macros rather than discipline. The biggest hand-written files are either a
single deduplicating macro (`diesel_common/jobs.rs`) or inherently complex state
machines (the saga orchestrator, the scheduler loop) — large because the *problem*
is, not because concerns are tangled.

**The guardrails that keep it that way** are the six boundary rules above. Most
architectural drift in a system like this comes from eroding exactly those: a
Python module that imports a Rust internal, an `asyncio` call that leaks into the
sync path, a storage method copy-pasted across backends, a new responsibility
bolted onto `app.py`. Hold the rules and the design scales with the contributor
count.

**On rebuilding.** This document was produced after assessing whether Taskito
needed a "clean-architecture rebuild." It does not. A speculative rewrite of
working, layered code covered by 1,007 Python tests plus the Rust contract suite
would import regressions for no product gain — the opposite of preparing to scale.
The leverage is in *navigability*: making the existing structure legible so the
next hundred changes land in the right place. That is what this file is for.
