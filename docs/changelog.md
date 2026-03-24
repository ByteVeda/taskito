# Changelog

All notable changes to taskito are documented here.

## 0.10.1

### Changed

- Repository transferred to [ByteVeda](https://github.com/ByteVeda/taskito) org
- Documentation URL updated to [docs.byteveda.org/taskito](https://docs.byteveda.org/taskito)
- All internal links updated from `pratyush618/taskito` to `ByteVeda/taskito`

---

## 0.10.0

### Features

- **Dashboard rebuild** -- full rewrite of the web dashboard using Preact, Vite, and Tailwind CSS; production-grade dark/light UI with lucide icons, toast notifications, loading states, timeseries charts, and 3 new pages (Resources, Queue Management, System Internals); 128KB single-file HTML (32KB gzipped) served from the Python package with zero runtime dependencies
- **Smart scheduling** -- adaptive backpressure polling (50ms base → 200ms max backoff when idle, instant reset on dispatch); per-task duration cache tracks average execution time in-memory; weighted least-loaded dispatch for prefork pool factors in task duration (`score = in_flight × avg_duration`)

### Internal

- Dashboard frontend source in `dashboard/` (Preact + Vite + Tailwind CSS + TypeScript); build via `cd dashboard && npm run build`; output inlined into `py_src/taskito/templates/dashboard.html`
- `dashboard.py` simplified to read single pre-built HTML instead of composing from 8 separate template files
- `Scheduler::run()` uses adaptive polling with exponential backoff (50ms → 200ms max); `tick()` returns `bool` for feedback
- `TaskDurationCache` in-memory HashMap tracks per-task avg wall_time_ns, updated on every `handle_result()`
- `weighted_least_loaded()` dispatch strategy in `prefork/dispatch.rs`; `aging_factor` field added to `SchedulerConfig`

---

## 0.9.0

### Features

- **Prefork worker pool** -- `queue.run_worker(pool="prefork", app="myapp:queue")` spawns child Python processes with independent GILs for true CPU parallelism; each child imports the app module, builds its own task registry, and executes tasks in a read-execute-write loop over JSON Lines IPC; the parent Rust scheduler dequeues jobs and dispatches to the least-loaded child via stdin pipes; reader threads parse child stdout and feed results back to the scheduler; graceful shutdown sends shutdown messages to children and waits with timeout before killing
- **Worker discovery** -- `queue.workers()` now returns `hostname`, `pid`, `pool_type`, and `started_at` for each worker, giving operators visibility into multi-machine deployments
- **Worker lifecycle events** -- three new event types: `WORKER_ONLINE` (registered in storage), `WORKER_OFFLINE` (dead worker reaped), `WORKER_UNHEALTHY` (resource health degraded); subscribe via `queue.on_event(EventType.WORKER_OFFLINE, callback)`
- **Worker status transitions** -- workers report `active → draining → stopped` status; shutdown signal sets status to `"draining"` before drain timeout, visible in `queue.workers()` and the dashboard
- **Orphan rescue prep** -- `list_claims_by_worker` storage method enables future orphaned job rescue when dead workers are detected
- **Task result streaming** -- `current_job.publish(data)` streams partial results from inside tasks; `job.stream()` / `await job.astream()` iterates partial results as they arrive; built on existing `task_logs` infrastructure with `level="result"` (no new tables or Rust changes); FastAPI SSE endpoint supports `?include_results=true` to stream partial results alongside progress

### Internal

- New Rust module `crates/taskito-python/src/prefork/` with 4 files: `mod.rs` (PreforkPool + WorkerDispatcher impl), `child.rs` (ChildWriter/ChildReader/ChildProcess split handles), `protocol.rs` (ParentMessage/ChildMessage JSON serialization), `dispatch.rs` (least-loaded dispatcher)
- New Python package `py_src/taskito/prefork/` with `child.py` (child process main loop), `__init__.py` (PreforkConfig), `__main__.py` (entry point)
- `base64` and `gethostname` crates added to `taskito-python` dependencies
- `run_worker()` gains `pool` and `app_path` parameters in both Rust (`py_queue/worker.rs`) and Python (`app.py`)
- `workers` table gains 4 columns: `started_at`, `hostname`, `pid`, `pool_type` (all backends + migrations)
- `reap_dead_workers` returns `Vec<String>` (reaped worker IDs) instead of `u64`; enables `WORKER_OFFLINE` event emission
- New storage methods: `update_worker_status`, `list_claims_by_worker` across all 3 backends

---

## 0.8.0

### Features

- **Namespace-based routing** -- `Queue(namespace="team-a")` isolates workloads across teams/services sharing a single database; enqueued jobs carry the namespace, workers only dequeue matching jobs, `list_jobs()` and `list_jobs_filtered()` default to the queue's namespace (pass `namespace=None` for global view); DLQ and archival preserve namespace through the full job lifecycle; periodic tasks inherit namespace from their scheduler; backward compatible (`None` namespace matches only `NULL`-namespace jobs)

### Internal

- `namespace` column added to `dead_letter` and `archived_jobs` tables; `DeadLetterRow`, `NewDeadLetterRow`, `ArchivedJobRow` models updated; Redis `DeadJobEntry` uses `#[serde(default)]` for backward compatibility
- `Storage` trait: `dequeue`, `dequeue_from`, `list_jobs`, `list_jobs_filtered` signatures gain `namespace: Option<&str>` parameter; all 3 backends + delegate macro updated
- `Scheduler` struct carries `namespace: Option<String>` field, passes to `dequeue_from` in poller
- `PyQueue` struct carries `namespace: Option<String>` field; `PyJob` exposes `namespace` to Python
- `_UNSET` sentinel in `mixins.py` distinguishes "namespace not passed" from explicit `None`

---

## 0.7.0

### Features

- **Async canvas primitives** -- `Signature.apply_async()`, `chain.apply_async()`, `group.apply_async()`, and `chord.apply_async()` for non-blocking workflow execution from async contexts; `chain` uses `aresult()` for truly async step-by-step execution; `group` uses `asyncio.gather` for concurrent wave awaiting; `chord` awaits all group results then enqueues the callback
- **Sample-based circuit breaker recovery** -- half-open state now allows N probe requests (default 5) instead of a single probe; closes only when the success rate meets a configurable threshold (default 80%); immediately re-opens when the threshold becomes mathematically impossible; timeout safety valve re-opens if probes don't complete within the cooldown period; configure via `circuit_breaker={"half_open_probes": 5, "half_open_success_rate": 0.8}` on `@queue.task()`
- **`enqueue_many()` parity with `enqueue()`** -- batch enqueue now supports per-job `delay`/`delay_list`, `unique_keys`, `metadata`/`metadata_list`, `expires`/`expires_list`, and `result_ttl`/`result_ttl_list` parameters; also emits `JOB_ENQUEUED` events and dispatches `on_enqueue` middleware hooks, matching single-enqueue behavior
- **`TaskFailedError` exception** -- new exception type in the hierarchy for tasks that failed (as opposed to cancelled or dead-lettered); `job.result()` now raises `TaskFailedError`, `TaskCancelledError`, `MaxRetriesExceededError`, or `SerializationError` instead of generic `RuntimeError`
- **`PyResultSender` conditional export** -- `from taskito import PyResultSender` works when built with `native-async` feature; silently unavailable otherwise (no confusing `AttributeError`)

### Fixes

- **Middleware context `queue_name` was `"unknown"`** -- `on_retry`, `on_dead_letter`, `on_cancel`, and `on_timeout` middleware hooks now receive the actual queue name from the job instead of a hardcoded `"unknown"` string
- **Redis `KEYS *` in lock reaping** -- `reap_expired_locks` replaced `KEYS` (O(N), blocks Redis server) with cursor-based `SCAN` using `COUNT 100`
- **Redis execution claims never expire** -- `claim_execution` now uses `SET NX PX 86400000` (24-hour TTL); orphaned claims from dead workers auto-expire instead of blocking re-execution forever
- **`_taskito_is_async` fragility** -- `_taskito_is_async` and `_taskito_async_fn` are now declared fields on `TaskWrapper.__init__` instead of dynamically monkey-patched attributes; prevents silent fallback to sync execution path if attributes are missing

### Internal

- All production Rust `eprintln!` calls replaced with `log` crate macros (`log::info!`, `log::warn!`, `log::error!`); `log` dependency added to `taskito-python` and `taskito-async` crates
- `ResultOutcome::Retry`, `::DeadLettered`, `::Cancelled` now carry `queue: String` for middleware context
- Ruff `target-version` updated from `py39` to `py310` to match `requires-python = ">=3.10"`
- Fixed UP035 (`Callable` import from `collections.abc`) and B905 (`zip()` without `strict=`) lint warnings
- Circuit breakers schema: 5 new columns on `circuit_breakers` table (`half_open_max_probes`, `half_open_success_rate`, `half_open_probe_count`, `half_open_success_count`, `half_open_failure_count`) with backward-compatible defaults

---

## 0.6.0

### Features

- **Middleware lifecycle hooks wired** -- `on_retry(ctx, error, retry_count)`, `on_dead_letter(ctx, error)`, and `on_cancel(ctx)` are now dispatched from the Rust result handler; they fire for every matching outcome across all registered middleware
- **Expanded middleware hooks** -- `TaskMiddleware` gains four new hooks: `on_enqueue`, `on_dead_letter`, `on_timeout`, `on_cancel`; `on_enqueue` receives a mutable `options` dict that can modify priority, delay, queue, and other enqueue parameters before the job is written
- **`JOB_RETRYING`, `JOB_DEAD`, `JOB_CANCELLED` events now emitted** -- these three event types were previously defined but never fired; they are now emitted from the Rust result handler with payloads `{job_id, task_name, error, retry_count}`, `{job_id, task_name, error}`, and `{job_id, task_name}` respectively
- **Queue-level rate limits** -- `queue.set_queue_rate_limit("name", "100/m")` applies a token-bucket rate limit to an entire queue, checked in the scheduler before per-task limits
- **Queue-level concurrency caps** -- `queue.set_queue_concurrency("name", 10)` limits how many jobs from a queue run simultaneously across all workers, checked before per-task `max_concurrent`
- **Worker lifecycle events** -- `EventType.WORKER_STARTED` and `EventType.WORKER_STOPPED` fired when a worker thread comes online or exits; subscribe via `queue.on_event(EventType.WORKER_STARTED, cb)`
- **Queue pause/resume events** -- `EventType.QUEUE_PAUSED` and `EventType.QUEUE_RESUMED` fired by `queue.pause()` and `queue.resume()`
- **`event_workers` parameter** -- `Queue(event_workers=N)` configures the event bus thread pool size (default 4); raise for high event volume
- **Per-webhook delivery options** -- `queue.add_webhook()` now accepts `max_retries`, `timeout`, and `retry_backoff` per endpoint, replacing the previous hardcoded values
- **OTel customization** -- `OpenTelemetryMiddleware` adds `span_name_fn`, `attribute_prefix`, `extra_attributes_fn`, and `task_filter` parameters
- **Sentry customization** -- `SentryMiddleware` adds `tag_prefix`, `transaction_name_fn`, `task_filter`, and `extra_tags_fn` parameters
- **Prometheus customization** -- `PrometheusMiddleware` and `PrometheusStatsCollector` add `namespace`, `extra_labels_fn`, and `disabled_metrics` parameters; metrics grouped by category (`"jobs"`, `"queue"`, `"resource"`, `"proxy"`, `"intercept"`)
- **FastAPI route selection** -- `TaskitoRouter` adds `include_routes`/`exclude_routes`, `dependencies`, `sse_poll_interval`, `result_timeout`, `default_page_size`, `max_page_size`, and `result_serializer` parameters; new endpoints: `/health`, `/readiness`, `/resources`, `/stats/queues`
- **Flask CLI group** -- `Taskito(app, cli_group="tasks")` renames the CLI command group; `flask taskito info --format json` outputs machine-readable stats
- **Django settings** -- `TASKITO_AUTODISCOVER_MODULE`, `TASKITO_ADMIN_PER_PAGE`, `TASKITO_ADMIN_TITLE`, `TASKITO_ADMIN_HEADER`, `TASKITO_DASHBOARD_HOST`, `TASKITO_DASHBOARD_PORT` control autodiscovery, admin pagination, branding, and dashboard bind address
- **`max_retry_delay` on `@queue.task()`** -- caps exponential backoff at a configurable ceiling in seconds (defaults to 300 s)
- **`max_concurrent` on `@queue.task()`** -- limits how many instances of a task run simultaneously across all workers
- **`serializer` on `@queue.task()`** -- per-task serializer override; falls back to queue-level serializer
- **Per-task serializer full round-trip** -- deserialization now also uses the per-task serializer; previously only enqueue (serialization) did; both the sync and native-async worker paths call `_deserialize_payload(task_name, payload)` instead of cloudpickle directly
- **`on_timeout` middleware hook wired** -- `on_timeout(ctx)` now fires when the Rust maintenance reaper detects a stale job that exceeded its hard timeout; fires before `on_retry` (if retrying) or `on_dead_letter` (if retries exhausted); previously the hook existed in `TaskMiddleware` but was never called
- **`QUEUE_PAUSED` / `QUEUE_RESUMED` events emitted** -- `queue.pause()` and `queue.resume()` now emit these events with payload `{"queue": "..."}` after updating storage; previously the event types were defined but never fired
- **Scheduler tuning** -- `Queue(scheduler_poll_interval_ms=N, scheduler_reap_interval=N, scheduler_cleanup_interval=N)` exposes the three Rust scheduler timing knobs to Python

---

For older releases (0.5.0 and below), see the [changelog archive](changelog/archive.md).
