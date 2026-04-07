# Queue — Workers & Hooks

Methods for running workers, lifecycle hooks, circuit breakers, and the sync/async method mapping.

## Workers

### `queue.run_worker()`

```python
queue.run_worker(
    queues: Sequence[str] | None = None,
    tags: list[str] | None = None,
    pool: str = "thread",
    app: str | None = None,
) -> None
```

Start the worker loop. **Blocks** until interrupted.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `queues` | `Sequence[str] | None` | `None` | Queue names to consume from. `None` = all. |
| `tags` | `list[str] | None` | `None` | Tags for worker specialization / routing. |
| `pool` | `str` | `"thread"` | Worker pool type: `"thread"` or `"prefork"`. |
| `app` | `str | None` | `None` | Import path to Queue (e.g. `"myapp:queue"`). Required when `pool="prefork"`. |

### `queue.workers()`

```python
queue.workers() -> list[dict]
```

Return live state of all registered workers. Each dict contains:

| Key | Type | Description |
|-----|------|-------------|
| `worker_id` | `str` | Unique worker ID |
| `hostname` | `str` | OS hostname |
| `pid` | `int` | Process ID |
| `status` | `str` | `"active"` or `"draining"` |
| `pool_type` | `str` | `"thread"`, `"prefork"`, or `"native-async"` |
| `started_at` | `int` | Registration timestamp (ms since epoch) |
| `last_heartbeat` | `int` | Last heartbeat timestamp (ms) |
| `queues` | `str` | Comma-separated queue names |
| `threads` | `int` | Worker thread/process count |
| `tags` | `str | None` | Worker specialization tags |
| `resources` | `str | None` | Registered resource names (JSON) |
| `resource_health` | `str | None` | Per-resource health status (JSON) |

### `await queue.aworkers()`

```python
await queue.aworkers() -> list[dict]
```

Async version of `workers()`.

### `queue.arun_worker()`

```python
await queue.arun_worker(
    queues: Sequence[str] | None = None,
    tags: list[str] | None = None,
) -> None
```

Async version of `run_worker()`. Runs the worker in a thread pool without blocking the event loop.

## Circuit Breakers

### `queue.circuit_breakers()`

```python
queue.circuit_breakers() -> list[dict]
```

Return current state of all circuit breakers: task name, state (`closed`/`open`/`half-open`), failure count, last failure time.

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
