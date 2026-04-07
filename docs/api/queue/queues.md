# Queue — Queue & Stats

Methods for managing queues, collecting statistics, and handling dead letters.

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
