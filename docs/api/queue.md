# Queue

::: taskito.app.Queue

The central class for creating and managing a task queue.

## Constructor

```python
Queue(
    db_path: str = ".taskito/taskito.db",
    workers: int = 0,
    default_retry: int = 3,
    default_timeout: int = 300,
    default_priority: int = 0,
    result_ttl: int | None = None,
    middleware: list[TaskMiddleware] | None = None,
    drain_timeout: int = 30,
    interception: str = "off",
    max_intercept_depth: int = 10,
    recipe_signing_key: str | None = None,
    max_reconstruction_timeout: int = 10,
    file_path_allowlist: list[str] | None = None,
    disabled_proxies: list[str] | None = None,
    async_concurrency: int = 100,
    event_workers: int = 4,
    scheduler_poll_interval_ms: int = 50,
    scheduler_reap_interval: int = 100,
    scheduler_cleanup_interval: int = 1200,
    namespace: str | None = None,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `db_path` | `str` | `".taskito/taskito.db"` | Path to SQLite database file. Parent directories are created automatically. |
| `workers` | `int` | `0` | Number of worker threads (`0` = auto-detect CPU count) |
| `default_retry` | `int` | `3` | Default max retry attempts for tasks |
| `default_timeout` | `int` | `300` | Default task timeout in seconds |
| `default_priority` | `int` | `0` | Default task priority (higher = more urgent) |
| `result_ttl` | `int \| None` | `None` | Auto-cleanup completed/dead jobs older than this many seconds. `None` disables. |
| `middleware` | `list[TaskMiddleware] \| None` | `None` | Queue-level middleware applied to all tasks. |
| `drain_timeout` | `int` | `30` | Seconds to wait for in-flight tasks during graceful shutdown. |
| `interception` | `str` | `"off"` | Argument interception mode: `"strict"`, `"lenient"`, or `"off"`. See [Resource System](../guide/resources.md#layer-1-argument-interception). |
| `max_intercept_depth` | `int` | `10` | Max recursion depth for argument walking. |
| `recipe_signing_key` | `str \| None` | `None` | HMAC-SHA256 key for proxy recipe integrity. Falls back to `TASKITO_RECIPE_SECRET` env var. |
| `max_reconstruction_timeout` | `int` | `10` | Max seconds allowed for proxy reconstruction. |
| `file_path_allowlist` | `list[str] \| None` | `None` | Allowed file path prefixes for the file proxy handler. |
| `disabled_proxies` | `list[str] \| None` | `None` | Handler names to skip when registering built-in proxy handlers. |
| `async_concurrency` | `int` | `100` | Maximum number of `async def` tasks running concurrently on the native async executor. |
| `event_workers` | `int` | `4` | Thread pool size for the event bus. Increase for high event volume. |
| `scheduler_poll_interval_ms` | `int` | `50` | Milliseconds between scheduler poll cycles. Lower values improve scheduling precision at the cost of CPU. |
| `scheduler_reap_interval` | `int` | `100` | Reap stale/timed-out jobs every N poll cycles. |
| `scheduler_cleanup_interval` | `int` | `1200` | Clean up old completed jobs every N poll cycles. |
| `namespace` | `str \| None` | `None` | Namespace for multi-tenant isolation. Jobs enqueued on this queue carry this namespace; workers only dequeue matching jobs. `None` means no namespace (default). |

## Task Registration

### `@queue.task()`

```python
@queue.task(
    name: str | None = None,
    max_retries: int = 3,
    retry_backoff: float = 1.0,
    retry_delays: list[float] | None = None,
    max_retry_delay: int | None = None,
    timeout: int = 300,
    soft_timeout: float | None = None,
    priority: int = 0,
    rate_limit: str | None = None,
    queue: str = "default",
    circuit_breaker: dict | None = None,
    middleware: list[TaskMiddleware] | None = None,
    expires: float | None = None,
    inject: list[str] | None = None,
    serializer: Serializer | None = None,
    max_concurrent: int | None = None,
) -> TaskWrapper
```

Register a function as a background task. Returns a [`TaskWrapper`](task.md).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | `str \| None` | Auto-generated | Explicit task name. Defaults to `module.qualname`. |
| `max_retries` | `int` | `3` | Max retry attempts before moving to DLQ. |
| `retry_backoff` | `float` | `1.0` | Base delay in seconds for exponential backoff. |
| `retry_delays` | `list[float] \| None` | `None` | Per-attempt delays in seconds, overrides backoff. e.g. `[1, 5, 30]`. |
| `max_retry_delay` | `int \| None` | `None` | Cap on backoff delay in seconds. Defaults to 300 s. |
| `timeout` | `int` | `300` | Hard execution time limit in seconds. |
| `soft_timeout` | `float \| None` | `None` | Cooperative time limit checked via `current_job.check_timeout()`. |
| `priority` | `int` | `0` | Default priority (higher = more urgent). |
| `rate_limit` | `str \| None` | `None` | Rate limit string, e.g. `"100/m"`. |
| `queue` | `str` | `"default"` | Named queue to submit to. |
| `circuit_breaker` | `dict \| None` | `None` | Circuit breaker config: `{"threshold": 5, "window": 60, "cooldown": 120}`. |
| `middleware` | `list[TaskMiddleware] \| None` | `None` | Per-task middleware, applied in addition to queue-level middleware. |
| `expires` | `float \| None` | `None` | Seconds until the job expires if not started. |
| `inject` | `list[str] \| None` | `None` | Resource names to inject as keyword arguments. See [Resource System](../guide/resources.md). |
| `serializer` | `Serializer \| None` | `None` | Per-task serializer override. Falls back to queue-level serializer. |
| `max_concurrent` | `int \| None` | `None` | Max concurrent running instances. `None` = no limit. |

### `@queue.periodic()`

```python
@queue.periodic(
    cron: str,
    name: str | None = None,
    args: tuple = (),
    kwargs: dict | None = None,
    queue: str = "default",
    timezone: str | None = None,
) -> TaskWrapper
```

Register a periodic (cron-scheduled) task. Uses 6-field cron expressions with seconds.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `cron` | `str` | — | 6-field cron expression (seconds precision). |
| `name` | `str \| None` | Auto-generated | Explicit task name. |
| `args` | `tuple` | `()` | Positional arguments passed to the task on each run. |
| `kwargs` | `dict \| None` | `None` | Keyword arguments passed to the task on each run. |
| `queue` | `str` | `"default"` | Named queue to submit to. |
| `timezone` | `str \| None` | `None` | IANA timezone name (e.g. `"America/New_York"`). Defaults to UTC. |

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
    depends_on: str | list[str] | None = None,
) -> JobResult
```

Enqueue a task for execution. Returns a [`JobResult`](result.md) handle.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `depends_on` | `str \| list[str] \| None` | `None` | Job ID(s) this job depends on. See [Dependencies](../guide/dependencies.md). |

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
    delay: float | None = None,
    delay_list: list[float | None] | None = None,
    unique_keys: list[str | None] | None = None,
    metadata: str | None = None,
    metadata_list: list[str | None] | None = None,
    expires: float | None = None,
    expires_list: list[float | None] | None = None,
    result_ttl: int | None = None,
    result_ttl_list: list[int | None] | None = None,
) -> list[JobResult]
```

Enqueue multiple jobs in a single transaction for high throughput. Supports both uniform parameters (applied to all jobs) and per-job lists.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `delay` | `float \| None` | `None` | Uniform delay in seconds for all jobs |
| `delay_list` | `list[float \| None] \| None` | `None` | Per-job delays in seconds |
| `unique_keys` | `list[str \| None] \| None` | `None` | Per-job deduplication keys |
| `metadata` | `str \| None` | `None` | Uniform metadata JSON for all jobs |
| `metadata_list` | `list[str \| None] \| None` | `None` | Per-job metadata JSON |
| `expires` | `float \| None` | `None` | Uniform expiry in seconds for all jobs |
| `expires_list` | `list[float \| None] \| None` | `None` | Per-job expiry in seconds |
| `result_ttl` | `int \| None` | `None` | Uniform result TTL in seconds |
| `result_ttl_list` | `list[int \| None] \| None` | `None` | Per-job result TTL in seconds |

Per-job lists (`*_list`) take precedence over uniform values when both are provided.

## Job Management

### `queue.get_job()`

```python
queue.get_job(job_id: str) -> JobResult | None
```

Retrieve a job by ID. Returns `None` if not found.

### `queue.list_jobs()`

```python
queue.list_jobs(
    status: str | None = None,
    queue: str | None = None,
    task_name: str | None = None,
    limit: int = 50,
    offset: int = 0,
    namespace: str | None = _UNSET,
) -> list[JobResult]
```

List jobs with optional filters. Returns newest first. Defaults to the queue's namespace — pass `namespace=None` to see all namespaces.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | `str \| None` | `None` | Filter by status: `pending`, `running`, `completed`, `failed`, `dead`, `cancelled` |
| `queue` | `str \| None` | `None` | Filter by queue name |
| `task_name` | `str \| None` | `None` | Filter by task name |
| `limit` | `int` | `50` | Maximum results to return |
| `offset` | `int` | `0` | Pagination offset |

### `queue.list_jobs_filtered()`

```python
queue.list_jobs_filtered(
    status: str | None = None,
    queue: str | None = None,
    task_name: str | None = None,
    metadata_like: str | None = None,
    error_like: str | None = None,
    created_after: float | None = None,
    created_before: float | None = None,
    limit: int = 50,
    offset: int = 0,
    namespace: str | None = _UNSET,
) -> list[JobResult]
```

Extended filtering with metadata and error pattern matching and time range constraints. Defaults to the queue's namespace — pass `namespace=None` to see all namespaces.

### `queue.cancel_job()`

```python
queue.cancel_job(job_id: str) -> bool
```

Cancel a pending job. Returns `True` if cancelled, `False` if not pending. Cascade-cancels dependents.

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

### `queue.job_dag()`

```python
queue.job_dag(job_id: str) -> dict
```

Return a dependency graph for a job, including all ancestors and descendants. Useful for visualizing workflow chains.

## Queue Management

### `queue.set_queue_rate_limit()`

```python
queue.set_queue_rate_limit(queue_name: str, rate_limit: str) -> None
```

Set a rate limit for all jobs in a queue. Checked by the scheduler before per-task rate limits.

| Parameter | Type | Description |
|---|---|---|
| `queue_name` | `str` | Queue name (e.g. `"default"`). |
| `rate_limit` | `str` | Rate limit string: `"N/s"`, `"N/m"`, or `"N/h"`. |

### `queue.set_queue_concurrency()`

```python
queue.set_queue_concurrency(queue_name: str, max_concurrent: int) -> None
```

Set a maximum number of concurrently running jobs for a queue across all workers. Checked by the scheduler before per-task `max_concurrent` limits.

| Parameter | Type | Description |
|---|---|---|
| `queue_name` | `str` | Queue name (e.g. `"default"`). |
| `max_concurrent` | `int` | Maximum simultaneous running jobs from this queue. |

### `queue.pause()`

```python
queue.pause(queue_name: str) -> None
```

Pause a named queue. Workers continue running but skip jobs in this queue until it is resumed.

### `queue.resume()`

```python
queue.resume(queue_name: str) -> None
```

Resume a previously paused queue.

### `queue.paused_queues()`

```python
queue.paused_queues() -> list[str]
```

Return the names of all currently paused queues.

### `queue.purge()`

```python
queue.purge(
    queue: str | None = None,
    task_name: str | None = None,
    status: str | None = None,
) -> int
```

Delete jobs matching the given filters. Returns the count deleted.

### `queue.revoke_task()`

```python
queue.revoke_task(task_name: str) -> None
```

Prevent all future enqueues of the given task name. Existing pending jobs are not affected.

## Archival

### `queue.archive()`

```python
queue.archive(job_id: str) -> None
```

Move a completed or failed job to the archive for long-term retention.

### `queue.list_archived()`

```python
queue.list_archived(
    task_name: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]
```

List archived jobs with optional task name filter.

## Replay

### `queue.replay()`

```python
queue.replay(job_id: str) -> JobResult
```

Re-enqueue a completed or failed job with its original arguments. Returns the new job handle.

### `queue.replay_history()`

```python
queue.replay_history(job_id: str) -> list[dict]
```

Return the replay log for a job — every time it has been replayed and the resulting new job IDs.

## Statistics

### `queue.stats()`

```python
queue.stats() -> dict[str, int]
```

Returns `{"pending": N, "running": N, "completed": N, "failed": N, "dead": N, "cancelled": N}`.

### `queue.stats_by_queue()`

```python
queue.stats_by_queue() -> dict[str, dict[str, int]]
```

Returns per-queue status counts: `{queue_name: {"pending": N, ...}}`.

### `queue.stats_all_queues()`

```python
queue.stats_all_queues() -> dict[str, dict[str, int]]
```

Returns stats for all queues including those with zero jobs.

### `queue.metrics()`

```python
queue.metrics() -> dict
```

Returns current throughput and latency snapshot.

### `queue.metrics_timeseries()`

```python
queue.metrics_timeseries(
    window: int = 3600,
    bucket: int = 60,
) -> list[dict]
```

Returns historical metrics bucketed by time. `window` is the lookback period in seconds; `bucket` is the bucket size in seconds.

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

## Distributed Locking

### `queue.lock()`

```python
queue.lock(
    name: str,
    ttl: int = 30,
    auto_extend: bool = True,
    owner_id: str | None = None,
    timeout: float | None = None,
    retry_interval: float = 0.1,
) -> contextlib.AbstractContextManager
```

Acquire a distributed lock. Use as a context manager:

```python
with queue.lock("my-resource", ttl=60):
    # exclusive section
    ...
```

Raises `LockNotAcquired` if acquisition fails (when `timeout` is `None` or expires).

### `queue.alock()`

```python
queue.alock(
    name: str,
    ttl: float = 30.0,
    auto_extend: bool = True,
    owner_id: str | None = None,
    timeout: float | None = None,
    retry_interval: float = 0.1,
) -> AsyncDistributedLock
```

Async context manager version of `lock()`. Returns an `AsyncDistributedLock` directly — use `async with`, not `await`:

```python
async with queue.alock("my-resource"):
    ...
```

## Workers

### `queue.run_worker()`

```python
queue.run_worker(
    queues: Sequence[str] | None = None,
    tags: list[str] | None = None,
) -> None
```

Start the worker loop. **Blocks** until interrupted. Pass `queues` to limit which queues are processed; pass `tags` to specialize this worker.

### `queue.workers()`

```python
queue.workers() -> list[dict]
```

Return live state of all registered workers: ID, hostname, started_at, last_heartbeat, current job.

### `await queue.aworkers()`

```python
await queue.aworkers() -> list[dict]
```

Async version of `workers()`.

## Circuit Breakers

### `queue.circuit_breakers()`

```python
queue.circuit_breakers() -> list[dict]
```

Return current state of all circuit breakers: task name, state (`closed`/`open`/`half-open`), failure count, last failure time.

## Resource System

### `@queue.worker_resource()`

```python
@queue.worker_resource(
    name: str,
    depends_on: list[str] | None = None,
    teardown: Callable | None = None,
    health_check: Callable | None = None,
    health_check_interval: float = 0.0,
    max_recreation_attempts: int = 3,
    scope: str = "worker",
    pool_size: int | None = None,
    pool_min: int = 0,
    acquire_timeout: float = 10.0,
    max_lifetime: float = 3600.0,
    idle_timeout: float = 300.0,
    reloadable: bool = False,
    frozen: bool = False,
) -> Callable
```

Decorator to register a resource factory initialized at worker startup.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | `str` | — | Resource name used in `inject=["name"]` or `Inject["name"]`. |
| `depends_on` | `list[str] \| None` | `None` | Names of resources this one depends on. |
| `teardown` | `Callable \| None` | `None` | Called with the resource instance on shutdown. |
| `health_check` | `Callable \| None` | `None` | Called periodically; returns truthy if healthy. |
| `health_check_interval` | `float` | `0.0` | Seconds between health checks (0 = disabled). |
| `max_recreation_attempts` | `int` | `3` | Max times to recreate on health failure. |
| `scope` | `str` | `"worker"` | Lifetime scope: `"worker"`, `"task"`, `"thread"`, or `"request"`. |
| `pool_size` | `int \| None` | `None` | Pool capacity for task-scoped resources (default = worker thread count). |
| `pool_min` | `int` | `0` | Pre-warmed instances for task-scoped resources. |
| `acquire_timeout` | `float` | `10.0` | Max seconds to wait for a pool instance. |
| `max_lifetime` | `float` | `3600.0` | Max seconds a pooled instance can live. |
| `idle_timeout` | `float` | `300.0` | Max idle seconds before pool eviction. |
| `reloadable` | `bool` | `False` | Allow hot-reload via SIGHUP. |
| `frozen` | `bool` | `False` | Wrap in a read-only proxy that blocks attribute writes. |

### `queue.register_resource()`

```python
queue.register_resource(definition: ResourceDefinition) -> None
```

Programmatically register a `ResourceDefinition`. Equivalent to `@queue.worker_resource()` but accepts a pre-built definition object.

### `queue.load_resources()`

```python
queue.load_resources(toml_path: str) -> None
```

Load resource definitions from a TOML file. Must be called before `run_worker()`. See [TOML Configuration](../guide/resources.md#toml-configuration).

### `queue.health_check()`

```python
queue.health_check(name: str) -> bool
```

Run a resource's health check immediately. Returns `True` if healthy, `False` otherwise or if the runtime is not initialized.

### `queue.resource_status()`

```python
queue.resource_status() -> list[dict]
```

Return per-resource status. Each entry contains: `name`, `scope`, `health`, `init_duration_ms`, `recreations`, `depends_on`. Task-scoped entries also include `pool` stats.

### `queue.register_type()`

```python
queue.register_type(
    python_type: type,
    strategy: str,
    *,
    resource: str | None = None,
    message: str | None = None,
    converter: Callable | None = None,
    type_key: str | None = None,
    proxy_handler: str | None = None,
) -> None
```

Register a custom type with the interception system. Requires `interception="strict"` or `"lenient"`.

| Parameter | Type | Description |
|---|---|---|
| `python_type` | `type` | The type to register. |
| `strategy` | `str` | `"pass"`, `"convert"`, `"redirect"`, `"reject"`, or `"proxy"`. |
| `resource` | `str \| None` | Resource name for `"redirect"` strategy. |
| `message` | `str \| None` | Rejection reason for `"reject"` strategy. |
| `converter` | `Callable \| None` | Converter callable for `"convert"` strategy. |
| `type_key` | `str \| None` | Dispatch key for the converter reconstructor. |
| `proxy_handler` | `str \| None` | Handler name for `"proxy"` strategy. |

### `queue.interception_stats()`

```python
queue.interception_stats() -> dict
```

Return interception metrics: total call count, per-strategy counts, average duration in ms, max depth reached. Returns an empty dict if interception is disabled.

### `queue.proxy_stats()`

```python
queue.proxy_stats() -> list[dict]
```

Return per-handler proxy metrics: handler name, deconstruction count, reconstruction count, error count, average reconstruction time in ms.

## Logs

### `queue.task_logs()`

```python
queue.task_logs(job_id: str, limit: int = 100) -> list[dict]
```

Return structured log entries emitted by `current_job.log()` during the given job's execution.

### `queue.query_logs()`

```python
queue.query_logs(
    task_name: str | None = None,
    level: str | None = None,
    message_like: str | None = None,
    since: float | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]
```

Query task logs across all jobs with optional filters.

## Events & Webhooks

### `queue.on_event()`

```python
queue.on_event(event: str) -> Callable
```

Register a callback for a queue event. Supported events: `job.completed`, `job.failed`, `job.retried`, `job.dead`.

```python
@queue.on_event("job.failed")
def handle_failure(job_id: str, task_name: str, error: str) -> None:
    ...
```

### `queue.add_webhook()`

```python
queue.add_webhook(
    url: str,
    events: list[EventType] | None = None,
    headers: dict[str, str] | None = None,
    secret: str | None = None,
    max_retries: int = 3,
    timeout: float = 10.0,
    retry_backoff: float = 2.0,
) -> None
```

Register a webhook URL for one or more events. 4xx responses are not retried; 5xx responses are retried with exponential backoff.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | `str` | — | URL to POST to. Must be `http://` or `https://`. |
| `events` | `list[EventType] \| None` | `None` | Event types to subscribe to. `None` means all events. |
| `headers` | `dict[str, str] \| None` | `None` | Extra HTTP headers to include. |
| `secret` | `str \| None` | `None` | HMAC-SHA256 signing secret for `X-Taskito-Signature`. |
| `max_retries` | `int` | `3` | Maximum delivery attempts. |
| `timeout` | `float` | `10.0` | HTTP request timeout in seconds. |
| `retry_backoff` | `float` | `2.0` | Base for exponential backoff between retries. |

## Worker

### `queue.arun_worker()`

```python
await queue.arun_worker(
    queues: Sequence[str] | None = None,
    tags: list[str] | None = None,
) -> None
```

Async version of `run_worker()`. Runs the worker in a thread pool without blocking the event loop.

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
| `queue.stats_by_queue()` | `await queue.astats_by_queue()` |
| `queue.stats_all_queues()` | `await queue.astats_all_queues()` |
| `queue.dead_letters()` | `await queue.adead_letters()` |
| `queue.retry_dead()` | `await queue.aretry_dead()` |
| `queue.cancel_job()` | `await queue.acancel_job()` |
| `queue.run_worker()` | `await queue.arun_worker()` |
| `queue.metrics()` | `await queue.ametrics()` |
| `queue.workers()` | `await queue.aworkers()` |
| `queue.circuit_breakers()` | `await queue.acircuit_breakers()` |
| `queue.replay()` | `await queue.areplay()` |
| `queue.lock()` | `queue.alock()` (async context manager, not a coroutine) |
| `queue.resource_status()` | `await queue.aresource_status()` |
