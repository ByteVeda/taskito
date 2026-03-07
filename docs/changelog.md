# Changelog

All notable changes to taskito are documented here.

## 0.2.3

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
