# Changelog

All notable changes to taskito are documented here.

## 0.5.0

### New Features

- **Native async tasks** -- `async def` task functions run natively on a dedicated event loop; no wrapping in `asyncio.run()` or thread bridging; dual-dispatch worker pool routes async jobs to `NativeAsyncPool` and sync jobs to the existing thread pool
- **`async_concurrency` parameter** -- `Queue(async_concurrency=100)` caps concurrent async tasks on the event loop; independent of the `workers` (sync thread) count
- **`current_job` in async tasks** -- `current_job.id`, `.log()`, `.update_progress()`, `.check_cancelled()` work inside `async def` tasks via `contextvars`; each concurrent task gets an isolated context
- **KEDA integration** -- `taskito scaler --app myapp:queue --port 9091` starts a lightweight metrics server; `/api/scaler` returns queue depth for KEDA `metrics-api` trigger; `/metrics` exposes Prometheus text format; `/health` for liveness probes
- **KEDA deploy templates** -- `deploy/keda/` contains ready-to-use `ScaledObject`, `ScaledObject` (Prometheus), and `ScaledJob` YAML manifests
- **Argument interception** -- `interception="strict"|"lenient"` on `Queue()` classifies every task argument before serialization; five strategies: PASS, CONVERT, REDIRECT, PROXY, REJECT; built-in rules cover UUID, datetime, Decimal, Pydantic models, dataclasses, SQLAlchemy sessions, Redis clients, file handles, and more
- **Worker resource runtime** -- `@queue.worker_resource("name")` decorator registers a factory initialized once at worker startup; four scopes: `"worker"` (default), `"task"` (pool), `"thread"` (thread-local), `"request"` (per-task fresh)
- **Resource injection** -- `@queue.task(inject=["name"])` or `db: Inject["name"]` annotation syntax injects live resources into tasks without serializing them; `from taskito import Inject`
- **Resource dependencies** -- `depends_on=["other"]` on `@queue.worker_resource()`; topological initialization order, reverse teardown; cycles detected eagerly at registration time (`CircularDependencyError`)
- **Health checking** -- `health_check=` and `health_check_interval=` on `@queue.worker_resource()`; unhealthy resources are recreated up to `max_recreation_attempts` times; `queue.health_check("name")` for manual checks
- **Resource pools** -- task-scoped resources get a semaphore-based pool with `pool_size`, `pool_min`, `acquire_timeout`, `max_lifetime`, `idle_timeout`; `pool_min > 0` pre-warms instances at startup
- **Thread-local resources** -- `scope="thread"` creates one instance per worker thread via `ThreadLocalStore`, torn down on shutdown
- **Frozen resources** -- `frozen=True` wraps the resource in a `FrozenResource` proxy that raises `AttributeError` on attribute writes
- **Hot reload** -- `reloadable=True` marks a resource for reload on `SIGHUP`; `taskito reload --app myapp:queue` CLI subcommand; `queue._resource_runtime.reload()` programmatic reload
- **TOML resource config** -- `queue.load_resources("resources.toml")` loads resource definitions from a TOML file; factory, teardown, and health_check are dotted import paths; Python 3.11+ built-in `tomllib`, older versions need `tomli`
- **Resource proxies** -- transparent deconstruct/reconstruct of non-serializable objects; built-in handlers: `file`, `logger`, `requests_session`, `httpx_client`, `boto3_client`, `gcs_client`
- **Proxy security** -- HMAC-SHA256 recipe signing via `recipe_signing_key=` on `Queue()` or `TASKITO_RECIPE_SECRET` env var; reconstruction timeout via `max_reconstruction_timeout=`; file path allowlist via `file_path_allowlist=`; per-handler opt-out via `disabled_proxies=`
- **`NoProxy` wrapper** -- `from taskito import NoProxy`; opt out of proxy handling for a specific argument, letting the serializer handle it directly
- **Custom type rules** -- `queue.register_type(MyType, "redirect", resource="my_resource")` registers custom types with any strategy (requires interception enabled)
- **Interception metrics** -- `queue.interception_stats()` returns total calls, per-strategy counts, average duration, and max depth reached
- **Proxy metrics** -- `queue.proxy_stats()` returns per-handler deconstruction/reconstruction counts, error counts, and average duration
- **Resource status** -- `queue.resource_status()` returns per-resource health, scope, init duration, and recreation count
- **Test mode resources** -- `queue.test_mode(resources={"db": mock_db})` injects mocks during test mode without worker startup; `MockResource(name, return_value=..., wraps=..., track_calls=True)` adds call tracking
- **Optional cloud dependencies** -- `pip install taskito[aws]` adds boto3>=1.20; `pip install taskito[gcs]` adds google-cloud-storage>=2.0

### Internal

- `crates/taskito-async/` new Rust crate: `NativeAsyncPool` implementing `WorkerDispatcher`, `PyResultSender` (#[pyclass]) bridging Python executor to Rust scheduler; feature-gated via `native-async` cargo feature
- `py_src/taskito/async_support/` package: `AsyncTaskExecutor` (dedicated event loop, bounded semaphore, full lifecycle support), `context.py` (contextvar-based job context), `__init__.py` public API
- `py_src/taskito/scaler.py`: `serve_scaler()` with `ThreadingHTTPServer`, routes `/api/scaler`, `/metrics`, `/health`
- Dashboard CSS and JS split into separate files (`assets/css/`, `assets/js/` modules)
- `_taskito_is_async` and `_taskito_async_fn` attributes set on task wrappers at registration time
- `py_src/taskito/interception/` package: `strategy.py`, `registry.py`, `walker.py`, `interceptor.py`, `reconstruct.py`, `converters.py`, `built_in.py`, `errors.py`, `metrics.py`
- `py_src/taskito/resources/` package: `definition.py`, `runtime.py`, `pool.py`, `thread_local.py`, `frozen.py`, `health.py`, `graph.py`, `toml_config.py`
- `py_src/taskito/proxies/` package: `handler.py`, `registry.py`, `reconstruct.py`, `signing.py`, `schema.py`, `no_proxy.py`, `metrics.py`, `built_in.py`, and `handlers/` subpackage
- `py_src/taskito/inject.py`: `Inject` metaclass for annotation-based resource injection
- Worker startup initializes `ResourceRuntime` before first dispatch; teardown on graceful shutdown
- `TestMode` extended with `resources=` parameter and `_test_mode_active` flag that disables proxy reconstruction during tests
- Worker heartbeat extended to include per-resource health JSON

---

## 0.4.0

### New Features

- **Distributed locking** — `queue.lock()` / `await queue.alock()` context managers with auto-extend background thread, acquisition timeout, and cross-process support; `LockNotAcquired` exception for failed acquisitions
- **Exactly-once semantics** — `claim_execution` / `complete_execution` storage layer prevents duplicate task execution across worker restarts
- **Async worker pool** — `AsyncWorkerPool` with `spawn_blocking` and GIL management; `WorkerDispatcher` trait in `taskito-core` future-proofs for other language bindings
- **Queue pause/resume** — `queue.pause()`, `queue.resume()`, `queue.paused_queues()` to suspend and restore processing per named queue
- **Job archival** — `queue.archive()` moves jobs to a persistent archive; `queue.list_archived()` retrieves them
- **Job revocation** — `queue.purge()` removes jobs by filter; `queue.revoke_task()` prevents all future enqueues of a given task name
- **Job replay** — `queue.replay()` re-enqueues a completed or failed job; `queue.replay_history()` returns the replay log
- **Circuit breakers** — `circuit_breaker={"threshold": 5, "window": 60, "cooldown": 120}` on `@queue.task()`; `queue.circuit_breakers()` returns current state of all circuit breakers
- **Structured task logging** — `current_job.log(message)` from inside tasks; `queue.task_logs(job_id)` and `queue.query_logs()` for retrieval
- **Cron timezone support** — `timezone="America/New_York"` on `@queue.periodic()`; uses `chrono-tz` under the hood, defaults to UTC
- **Custom retry delays** — `retry_delays=[1, 5, 30]` on `@queue.task()` for per-attempt delay overrides instead of exponential backoff
- **Soft timeouts** — `soft_timeout=` on `@queue.task()`; checked cooperatively via `current_job.check_timeout()`
- **Worker tags/specialization** — `tags=["gpu", "heavy"]` on `queue.run_worker()`; jobs can be routed to workers with matching tags
- **Worker inspection** — `queue.workers()` / `await queue.aworkers()` return live worker state
- **Job DAG visualization** — `queue.job_dag(job_id)` returns a dependency graph for a job and its ancestors/descendants
- **Metrics timeseries** — `queue.metrics_timeseries()` returns historical throughput/latency data; `queue.metrics()` for current snapshot
- **Extended job filtering** — `queue.list_jobs_filtered()` with `metadata_like`, `error_like`, `created_after`, `created_before` parameters
- **`MsgPackSerializer`** — built-in, requires `pip install msgpack`; faster than cloudpickle, smaller payloads, cross-language compatible
- **`EncryptedSerializer`** — AES-256-GCM encryption, requires `pip install cryptography`; wraps another serializer, payloads in DB are opaque ciphertext
- **`drain_timeout`** — configurable graceful shutdown wait time on `Queue()` constructor (default: 30 seconds)
- **Per-job `result_ttl`** — `result_ttl` override on `.apply_async()` to set cleanup policy per job
- **Dashboard enhancements** — workers tab, circuit breakers panel, job archival UI

### Internal

- `diesel_common/` shared macro module eliminates SQLite/Postgres duplication across backends
- `scheduler` split into 4 focused modules (`mod.rs`, `poller.rs`, `result_handler.rs`, `maintenance.rs`)
- `py_queue` split into 3 focused modules (`mod.rs`, `inspection.rs`, `worker.rs`) with PyO3 `multiple-pymethods` feature
- Python mixins consolidated from 7 to 3 groups: `QueueInspectionMixin`, `QueueOperationsMixin`, `QueueLockMixin`

---

## 0.3.0

### Features

- **Redis storage backend** — optional Redis backend for distributed workloads (`pip install taskito[redis]`); Lua scripts for atomic operations, sorted sets for indexing
- **Events & webhooks** — event system with webhook delivery support
- **Flask integration** — contrib integration for Flask applications
- **Prometheus integration** — contrib stats collector with `PrometheusStatsCollector`
- **Sentry integration** — contrib middleware for Sentry error tracking

### Build & CI

- Add `openssl-sys` dependency, refactor GitHub Actions for wheel building/publishing
- Enable postgres feature for macOS and Windows wheel builds
- Add Rust linting/caching, optimize test matrix, reduce redundant CI jobs
- Add redis feature to wheel builds

### Fixes

- Guard arithmetic overflow across timeout detection, worker reaping, scheduler cleanup, circuit breaker timing, and Redis TTL purging
- Treat cancelled jobs as terminal in `_poll_once` so `result()` raises immediately
- Cap float-to-i64 casts to prevent silent overflow in delay_seconds, expires, retry_delays, retry_backoff
- Reject negative pagination in list_jobs, dead_letters, list_archived, query_task_logs
- Fix async/sync misuse in FastAPI handlers
- Replace deprecated `asyncio.get_event_loop()` with `get_running_loop()`
- Replace Redis `KEYS` with `SCAN` in purge operations
- Fix Redis `enqueue_unique()` race condition with atomic Lua scripts
- Only call middleware `after()` for those whose `before()` succeeded
- Recover from poisoned mutex in scheduler instead of panicking
- Validate `EncryptedSerializer` key type and size before use
- Thread-safe double-checked locking for Prometheus metrics init and dashboard SPA cache
- Skip webhook retries on 4xx client errors
- Clamp percentile index in task_metrics to prevent IndexError
- Fix dashboard formatting

### Docs

- Add circuit breakers, events/webhooks, and logging guides
- Add integration docs for Django, FastAPI, Flask, OTel, Prometheus, Sentry
- Remove Linux-only warnings from postgres and installation docs

## 0.2.3

### Features

- **Postgres storage backend** — optional PostgreSQL backend for multi-machine workers and higher write throughput (`pip install taskito[postgres]`); full feature parity with SQLite including jobs, DLQ, rate limiting, periodic tasks, circuit breakers, workers, metrics, and logs
- **Django integration** — `TASKITO_BACKEND`, `TASKITO_DB_URL`, `TASKITO_SCHEMA` settings for configuring the backend from Django projects

### Build & Tooling

- **Pre-commit hooks** — Added `.pre-commit-config.yaml` with local hooks for `cargo fmt`, `cargo clippy`, `ruff check`, `ruff format`, and `mypy`

### Critical Fixes

- **Dashboard dead routes** — Moved `/logs` and `/replay-history` handlers above the generic catch-all in `dashboard.py`, fixing 404s on these endpoints
- **Stale `__version__`** — Replaced hardcoded version with `importlib.metadata.version()` with fallback
- **`retry_dead` non-atomic** — Wrapped enqueue + delete in a single transaction (SQLite & Postgres), preventing ghost dead letters on partial failure
- **`retry_dead` hardcoded defaults** — Added `priority`, `max_retries`, `timeout_ms`, `result_ttl_ms` columns to `dead_letter` table; replayed jobs now preserve their original configuration
- **`enqueue_unique` race condition** — Wrapped check + insert in a transaction; catches unique constraint violations to return the existing job instead of erroring
- **`now_millis()` panic** — Replaced `.expect()` with `.unwrap_or(Duration::ZERO)` to prevent scheduler panic on clock issues
- **`reap_stale` double error records** — Removed redundant `storage.fail()` call; `handle_result` already records the failure
- **README cron format** — Updated example to correct 6-field format: `"0 0 */6 * * *"`

### Important Fixes

- **`result.py` hardcoded cloudpickle** — `job.result()` now uses the queue's configured serializer for deserialization
- **Context leak on deserialization failure** — Wrapped deserialization + call in closure; `_clear_context` always runs via `finally`
- **OTel spans not thread-safe** — Added `threading.Lock` around all `_spans` dict access in `OpenTelemetryMiddleware`
- **`build_periodic_payload` misleading `_kwargs` param** — Removed unused parameter, added explanatory comment
- **Tokio runtime panic** — Replaced `.expect()` with graceful error handling on runtime creation
- **`dequeue` LIMIT 10** — Increased to 100 for better throughput under load (both SQLite & Postgres)
- **`check_periodic` not atomic** — Uses `enqueue_unique` with deterministic key to prevent duplicate periodic jobs
- **SQLite `purge_completed_with_ttl` no transaction** — Wrapped in transaction for consistency
- **Django admin status validation** — Added try/except around `queue.list_jobs()` to handle connection errors gracefully
- **Silent job loss on `get_job` None** — Added `warn!` logging when a dequeued job ID returns None
- **Cascade cleanup on job purge** — `purge_completed()` and `purge_completed_with_ttl()` now automatically delete orphaned child records (`job_errors`, `task_logs`, `task_metrics`, `job_dependencies`, `replay_history`) when removing completed jobs

### Minor Fixes

- **`cascade_cancel` O(n²)** — Replaced `Vec::contains` with `HashSet` for dependency lookups (both backends)
- **`chain.apply()` hardcoded 300s timeout** — Now derives timeout from `sig.options.get("timeout", 300)`
- **`_FakeJobResult` missing `refresh()`** — Added no-op method for test mode compatibility
- **Storage trait doc outdated** — Updated to mention both SQLite and Postgres backends
- **`wall_time_ns` truncation** — Uses `.try_into().unwrap_or(i64::MAX)` to prevent silent overflow

---

## 0.2.2

- Added `readme` field to `pyproject.toml` so PyPI displays the project description.

---

## 0.2.1

Re-release of 0.2.0 — PyPI does not allow re-uploads of deleted versions.

---

## 0.2.0

### Core Reliability

- **Exception hierarchy** (F8) — `TaskitoError` base class with `TaskTimeoutError`, `SoftTimeoutError`, `TaskCancelledError`, `MaxRetriesExceededError`, `SerializationError`, `CircuitBreakerOpenError`, `RateLimitExceededError`, `JobNotFoundError`, `QueueError`
- **Pluggable serializers** (F2) — `CloudpickleSerializer` (default), `JsonSerializer`, or custom `Serializer` protocol
- **Exception filtering** (F1) — `retry_on` and `dont_retry_on` parameters for selective retries
- **Cancel running tasks** (F3) — cooperative cancellation with `queue.cancel_running_job()` and `current_job.check_cancelled()`
- **Soft timeouts** (F4) — `soft_timeout` parameter with `current_job.check_timeout()` for cooperative time limits

### Developer Experience

- **Per-task middleware** (F5) — `TaskMiddleware` base class with `before()`, `after()`, `on_retry()` hooks; queue-level and per-task registration
- **Worker heartbeat** (F6) — `queue.workers()` / `await queue.aworkers()` to monitor worker health; `GET /api/workers` dashboard endpoint; `workers` table in schema
- **Job expiration** (F7) — `expires` parameter on `apply_async()` to skip time-sensitive jobs that weren't started in time
- **Result TTL per job** (F11) — `result_ttl` parameter on `apply_async()` to override global cleanup policy per job

### Power Features

- **chunks / starmap** (F9) — `chunks(task, items, chunk_size)` and `starmap(task, args_list)` canvas primitives
- **Group concurrency** (F10) — `max_concurrency` parameter on `group()` to limit parallel execution
- **OpenTelemetry** (F12) — `OpenTelemetryMiddleware` for distributed tracing; install with `pip install taskito[otel]`

### Build & Tooling

- Zensical site configuration (`zensical.toml`)
- Makefile for `docs` / `docs-serve` commands
- Lock file (`uv.lock`) for reproducible builds

### Bug Fixes

- Fixed "Copy as Markdown" table cells rendering empty for SVG/img emoji icons

### Internal

- Hardened core scheduler and rate limiter
- Reorganized resilience modules and storage layer

---

## 0.1.1

### Features

- **Web dashboard** -- `taskito dashboard --app myapp:queue` serves a built-in monitoring UI with dark mode, auto-refresh, job detail views, and dead letter management
- **FastAPI integration** -- `TaskitoRouter` provides a pre-built `APIRouter` with endpoints for stats, job status, progress streaming (SSE), and dead letter management
- **Testing utilities** -- `queue.test_mode()` context manager for running tasks synchronously without a worker; includes `TestResult`, `TestResults` with filtering
- **CLI dashboard command** -- `taskito dashboard` command with `--host` and `--port` options
- **Celery-style worker banner** -- Worker startup now displays registered tasks, queues, and configuration
- **Async result awaiting** -- `await job.aresult()` for non-blocking result fetching

### Changes

- Renamed `python/` to `py_src/` and `rust/` to `crates/` for clearer project structure
- Default `db_path` now uses `.taskito/` directory, with automatic directory creation

---

## 0.1.0

*Initial release*

### Features

- **Task queue** — `@queue.task()` decorator with `.delay()` and `.apply_async()`
- **Priority queues** — integer priority levels, higher values processed first
- **Retry with exponential backoff** — configurable max retries, backoff multiplier, and jitter
- **Dead letter queue** — failed jobs preserved for inspection and replay
- **Rate limiting** — token bucket algorithm with `"N/s"`, `"N/m"`, `"N/h"` syntax
- **Task workflows** — `chain`, `group`, and `chord` primitives
- **Periodic tasks** — cron-scheduled tasks with 6-field expressions (seconds granularity)
- **Progress tracking** — `current_job.update_progress()` from inside tasks
- **Job cancellation** — cancel pending jobs before execution
- **Unique tasks** — deduplicate active jobs by key
- **Batch enqueue** — `task.map()` and `queue.enqueue_many()` with single-transaction inserts
- **Named queues** — route tasks to isolated queues, subscribe workers selectively
- **Hooks** — `before_task`, `after_task`, `on_success`, `on_failure`
- **Async support** — `aresult()`, `astats()`, `arun_worker()`, and more
- **Job context** — `current_job.id`, `.task_name`, `.retry_count`, `.queue_name`
- **Error history** — per-attempt error tracking via `job.errors`
- **Result TTL** — automatic cleanup of completed/dead jobs
- **CLI** — `taskito worker` and `taskito info --watch`
- **Metadata** — attach arbitrary JSON to jobs

### Architecture

- Rust core with PyO3 bindings
- SQLite storage with WAL mode and Diesel ORM
- Tokio async scheduler with 50ms poll interval
- OS thread worker pool with crossbeam channels
- cloudpickle serialization for arguments and results
