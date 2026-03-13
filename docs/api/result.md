# JobResult

::: taskito.result.JobResult

Handle to an enqueued job. Provides methods to check status and retrieve results, both synchronously and asynchronously.

Returned by [`task.delay()`](task.md#taskdelay), [`task.apply_async()`](task.md#taskapply_async), [`queue.enqueue()`](queue.md#queueenqueue), and canvas operations.

## Properties

### `job.id`

```python
job.id -> str
```

The unique job ID (UUIDv7, time-ordered).

### `job.status`

```python
job.status -> str
```

Current job status. **Fetches fresh from the database** on every access.

Returns one of: `"pending"`, `"running"`, `"complete"`, `"failed"`, `"dead"`, `"cancelled"`.

```python
job = add.delay(2, 3)
print(job.status)  # "pending"
# ... after worker processes it ...
print(job.status)  # "complete"
```

### `job.progress`

```python
job.progress -> int | None
```

Current progress (0–100) if reported by the task via [`current_job.update_progress()`](context.md). Returns `None` if no progress has been reported. Refreshes from the database.

### `job.error`

```python
job.error -> str | None
```

Error message if the job failed. `None` if the job hasn't failed. Refreshes from the database.

### `job.errors`

```python
job.errors -> list[dict]
```

Full error history for this job — one entry per failed attempt. Each dict contains:

| Key | Type | Description |
|---|---|---|
| `id` | `str` | Error record ID |
| `job_id` | `str` | Parent job ID |
| `attempt` | `int` | Retry attempt number |
| `error` | `str` | Error message/traceback |
| `failed_at` | `str` | ISO timestamp of the failure |

```python
job = flaky_task.delay()
# ... after retries ...
for err in job.errors:
    print(f"Attempt {err['attempt']}: {err['error']}")
```

### `job.dependencies`

```python
job.dependencies -> list[str]
```

List of job IDs this job depends on. Returns an empty list if the job has no dependencies. See [Dependencies](../guide/dependencies.md).

### `job.dependents`

```python
job.dependents -> list[str]
```

List of job IDs that depend on this job. Returns an empty list if no other jobs depend on this one.

## Methods

### `job.to_dict()`

```python
job.to_dict() -> dict
```

Return all job fields as a plain dictionary. Useful for JSON serialization (e.g. in the [dashboard](../guide/dashboard.md) or [FastAPI integration](../guide/advanced.md#fastapi-integration)).

### `job.result()`

```python
job.result(
    timeout: float = 30.0,
    poll_interval: float = 0.05,
    max_poll_interval: float = 0.5,
) -> Any
```

**Block** until the job completes and return the deserialized result. Uses exponential backoff for polling — starts at `poll_interval` and gradually increases to `max_poll_interval`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `timeout` | `float` | `30.0` | Maximum seconds to wait |
| `poll_interval` | `float` | `0.05` | Initial seconds between status checks |
| `max_poll_interval` | `float` | `0.5` | Maximum seconds between status checks |

**Raises:**

- `TimeoutError` — if the job doesn't complete within `timeout`
- `RuntimeError` — if the job status is `"failed"` or `"dead"`

```python
job = add.delay(2, 3)
result = job.result(timeout=10)  # blocks, returns 5

# Custom polling for long-running tasks
result = job.result(timeout=600, poll_interval=1.0, max_poll_interval=5.0)
```

### `await job.aresult()`

```python
await job.aresult(
    timeout: float = 30.0,
    poll_interval: float = 0.05,
    max_poll_interval: float = 0.5,
) -> Any
```

Async version of `result()`. Uses `asyncio.sleep()` instead of `time.sleep()`, so it won't block the event loop.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `timeout` | `float` | `30.0` | Maximum seconds to wait |
| `poll_interval` | `float` | `0.05` | Initial seconds between status checks |
| `max_poll_interval` | `float` | `0.5` | Maximum seconds between status checks |

**Raises:**

- `TimeoutError` — if the job doesn't complete within `timeout`
- `RuntimeError` — if the job status is `"failed"` or `"dead"`

```python
job = add.delay(2, 3)
result = await job.aresult(timeout=10)
```
