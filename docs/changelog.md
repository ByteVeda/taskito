# Changelog

All notable changes to quickq are documented here.

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
- **CLI** — `quickq worker` and `quickq info --watch`
- **Metadata** — attach arbitrary JSON to jobs

### Architecture

- Rust core with PyO3 bindings
- SQLite storage with WAL mode and Diesel ORM
- Tokio async scheduler with 50ms poll interval
- OS thread worker pool with crossbeam channels
- cloudpickle serialization for arguments and results
