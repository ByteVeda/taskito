# Advanced

## Unique Tasks

Deduplicate active jobs by key — if a job with the same `unique_key` is already pending or running, the existing job is returned instead of creating a new one:

```python
job1 = process.apply_async(args=("report",), unique_key="daily-report")
job2 = process.apply_async(args=("report",), unique_key="daily-report")
assert job1.id == job2.id  # Same job, not duplicated
```

Once the original job completes (or fails to DLQ), the key is released and a new job can be created with the same key.

!!! info "Implementation"
    Deduplication uses a partial unique index: `CREATE UNIQUE INDEX ... ON jobs(unique_key) WHERE unique_key IS NOT NULL AND status IN (0, 1)`. Only pending and running jobs participate.

## Job Cancellation

Cancel a pending job before it starts:

```python
job = send_email.delay("user@example.com", "Hello", "World")
cancelled = queue.cancel_job(job.id)  # True if was pending
```

- Returns `True` if the job was pending and is now cancelled
- Returns `False` if the job was already running, completed, or in another non-pending state
- Cancelled jobs cannot be un-cancelled

## Result TTL & Auto-Cleanup

### Manual Cleanup

```python
# Purge completed jobs older than 1 hour
deleted = queue.purge_completed(older_than=3600)

# Purge dead letters older than 24 hours
deleted = queue.purge_dead(older_than=86400)
```

### Automatic Cleanup

Set `result_ttl` on the Queue to automatically purge old jobs while the worker runs:

```python
queue = Queue(
    db_path="myapp.db",
    result_ttl=3600,  # Auto-purge completed/dead jobs older than 1 hour
)
```

The scheduler checks every ~60 seconds and purges:

- Completed jobs older than `result_ttl`
- Dead letter entries older than `result_ttl`
- Error history records older than `result_ttl`

Set to `None` (default) to disable auto-cleanup.

## Async Support

All inspection methods have async variants that run in a thread pool:

```python
# Sync
stats = queue.stats()
dead = queue.dead_letters()
new_id = queue.retry_dead(dead_id)
cancelled = queue.cancel_job(job_id)
result = job.result(timeout=30)

# Async equivalents
stats = await queue.astats()
dead = await queue.adead_letters()
new_id = await queue.aretry_dead(dead_id)
cancelled = await queue.acancel_job(job_id)
result = await job.aresult(timeout=30)
```

### Async Worker

```python
async def main():
    await queue.arun_worker(queues=["default"])

asyncio.run(main())
```

## Batch Enqueue

Insert many jobs in a single SQLite transaction for high throughput:

### `task.map()`

```python
@queue.task()
def process(item_id):
    return fetch_and_process(item_id)

# Enqueue 1000 jobs in one transaction
jobs = process.map([(i,) for i in range(1000)])
```

### `queue.enqueue_many()`

```python
jobs = queue.enqueue_many(
    task_name="myapp.process",
    args_list=[(i,) for i in range(1000)],
    kwargs_list=None,   # Optional per-job kwargs
    priority=5,         # Same priority for all
    queue="processing", # Same queue for all
)
```

## SQLite Configuration

quickq configures SQLite for optimal performance:

| Pragma | Value | Purpose |
|---|---|---|
| `journal_mode` | WAL | Concurrent reads during writes |
| `busy_timeout` | 5000ms | Wait instead of failing on lock contention |
| `synchronous` | NORMAL | Balance between safety and speed |
| `journal_size_limit` | 64MB | Prevent unbounded WAL growth |

The connection pool uses up to 8 connections via `r2d2`.
