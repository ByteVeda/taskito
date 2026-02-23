# Queue

::: quickq.app.Queue

The central class for creating and managing a task queue.

## Constructor

```python
Queue(
    db_path: str = "quickq.db",
    workers: int = 0,
    default_retry: int = 3,
    default_timeout: int = 300,
    default_priority: int = 0,
    result_ttl: int | None = None,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `db_path` | `str` | `"quickq.db"` | Path to SQLite database file |
| `workers` | `int` | `0` | Number of worker threads (`0` = auto-detect CPU count) |
| `default_retry` | `int` | `3` | Default max retry attempts for tasks |
| `default_timeout` | `int` | `300` | Default task timeout in seconds |
| `default_priority` | `int` | `0` | Default task priority (higher = more urgent) |
| `result_ttl` | `int \| None` | `None` | Auto-cleanup completed/dead jobs older than this many seconds. `None` disables. |

## Task Registration

### `@queue.task()`

```python
@queue.task(
    name: str | None = None,
    max_retries: int = 3,
    retry_backoff: float = 1.0,
    timeout: int = 300,
    priority: int = 0,
    rate_limit: str | None = None,
    queue: str = "default",
) -> TaskWrapper
```

Register a function as a background task. Returns a [`TaskWrapper`](task.md).

### `@queue.periodic()`

```python
@queue.periodic(
    cron: str,
    name: str | None = None,
    args: tuple = (),
    kwargs: dict | None = None,
    queue: str = "default",
) -> TaskWrapper
```

Register a periodic (cron-scheduled) task. Uses 6-field cron expressions with seconds.

## Enqueue Methods

### `queue.enqueue()`

```python
queue.enqueue(
    task_name: str,
    args: tuple = (),
    kwargs: dict | None = None,
    priority: int | None = None,
    delay: float | None = None,
    queue: str | None = None,
    max_retries: int | None = None,
    timeout: int | None = None,
    unique_key: str | None = None,
    metadata: str | None = None,
) -> JobResult
```

Enqueue a task for execution. Returns a [`JobResult`](result.md) handle.

### `queue.enqueue_many()`

```python
queue.enqueue_many(
    task_name: str,
    args_list: list[tuple],
    kwargs_list: list[dict] | None = None,
    priority: int | None = None,
    queue: str | None = None,
    max_retries: int | None = None,
    timeout: int | None = None,
) -> list[JobResult]
```

Enqueue multiple jobs in a single SQLite transaction for high throughput.

## Job Management

### `queue.get_job()`

```python
queue.get_job(job_id: str) -> JobResult | None
```

Retrieve a job by ID. Returns `None` if not found.

### `queue.cancel_job()`

```python
queue.cancel_job(job_id: str) -> bool
```

Cancel a pending job. Returns `True` if cancelled, `False` if not pending.

### `queue.update_progress()`

```python
queue.update_progress(job_id: str, progress: int) -> None
```

Update progress for a running job (0–100).

### `queue.job_errors()`

```python
queue.job_errors(job_id: str) -> list[dict]
```

Get error history for a job. Returns a list of dicts with `id`, `job_id`, `attempt`, `error`, `failed_at`.

## Statistics

### `queue.stats()`

```python
queue.stats() -> dict[str, int]
```

Returns `{"pending": N, "running": N, "completed": N, "failed": N, "dead": N, "cancelled": N}`.

## Dead Letter Queue

### `queue.dead_letters()`

```python
queue.dead_letters(limit: int = 10, offset: int = 0) -> list[dict]
```

List dead letter entries. Each dict contains: `id`, `original_job_id`, `queue`, `task_name`, `error`, `retry_count`, `failed_at`, `metadata`.

### `queue.retry_dead()`

```python
queue.retry_dead(dead_id: str) -> str
```

Re-enqueue a dead letter job. Returns the new job ID.

### `queue.purge_dead()`

```python
queue.purge_dead(older_than: int = 86400) -> int
```

Purge dead letter entries older than `older_than` seconds. Returns count deleted.

## Cleanup

### `queue.purge_completed()`

```python
queue.purge_completed(older_than: int = 86400) -> int
```

Purge completed jobs older than `older_than` seconds. Returns count deleted.

## Worker

### `queue.run_worker()`

```python
queue.run_worker(queues: Sequence[str] | None = None) -> None
```

Start the worker loop. **Blocks** until interrupted. Pass `queues` to limit which queues are processed.

## Hooks

### `@queue.before_task`

```python
@queue.before_task
def hook(task_name: str, args: tuple, kwargs: dict) -> None: ...
```

### `@queue.after_task`

```python
@queue.after_task
def hook(task_name: str, args: tuple, kwargs: dict, result: Any, error: Exception | None) -> None: ...
```

### `@queue.on_success`

```python
@queue.on_success
def hook(task_name: str, args: tuple, kwargs: dict, result: Any) -> None: ...
```

### `@queue.on_failure`

```python
@queue.on_failure
def hook(task_name: str, args: tuple, kwargs: dict, error: Exception) -> None: ...
```

## Async Methods

| Sync | Async |
|---|---|
| `queue.stats()` | `await queue.astats()` |
| `queue.dead_letters()` | `await queue.adead_letters()` |
| `queue.retry_dead()` | `await queue.aretry_dead()` |
| `queue.cancel_job()` | `await queue.acancel_job()` |
| `queue.run_worker()` | `await queue.arun_worker()` |
