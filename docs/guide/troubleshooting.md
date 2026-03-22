# Troubleshooting

Common issues and how to fix them.

## Jobs stuck in running

**Symptom**: Jobs stay in `running` status long after they should have finished.

**Diagnosis**: The worker process that picked up the job crashed before marking it complete.

```python
# Check how many jobs are stuck
stats = queue.stats()
print(stats)  # {'running': 47, 'pending': 0, ...}

# See which jobs are stuck
stuck = queue.list_jobs(status="running", limit=20)
for job in stuck:
    d = job.to_dict()
    print(f"{d['id']} | {d['task_name']} | started {d['started_at']}")
```

**Fix**: The stale reaper handles this automatically — it detects jobs that have exceeded their `timeout_ms` and retries them. If a job has no timeout set, it stays stuck forever.

To recover a stuck job manually:

```python
import time

# Mark the job as failed so it retries
queue._inner.retry(job_id, int(time.time() * 1000))
```

To prevent this in future, always set a timeout on production tasks:

```python
@queue.task(timeout=300)  # 5 minutes max
def process_data(payload):
    ...
```

!!! warning
    Jobs without `timeout_ms` are never reaped. The stale reaper only detects jobs that have exceeded their deadline.

## Worker is unresponsive

**Symptom**: Worker process is alive but not processing jobs. Heartbeat is stale.

**Diagnosis**: Check worker status via the heartbeat API.

```python
workers = queue.workers()
for w in workers:
    print(f"{w['worker_id']}: {w['status']} (last seen: {w['last_heartbeat']})")
```

**Possible causes**:

1. **GIL-bound CPU task**: A long-running CPU task is holding the GIL, blocking the scheduler thread from dispatching new jobs. The scheduler runs in Rust, but it still needs the GIL to call Python functions.

    Fix: Switch to the prefork pool for CPU-bound tasks.

    ```bash
    taskito worker --app myapp:queue --pool prefork
    ```

2. **Deadlock**: A task is waiting on a resource held by another task in the same worker. Check for circular waits in your task code.

3. **Infinite loop**: A task is looping without yielding. Add a timeout to detect this:

    ```python
    @queue.task(timeout=60)
    def risky_task():
        ...
    ```

## Database growing too large

**Symptom**: The SQLite file keeps growing; disk space is filling up.

**Diagnosis**: Completed job records and their result payloads are accumulating.

**Fix**: Set `result_ttl` to auto-purge old results.

```python
queue = Queue(
    db_path="myapp.db",
    result_ttl=86400,  # Purge completed/dead jobs older than 24 hours
)
```

Manually purge existing backlog:

```python
# Purge completed jobs older than 7 days
queue.purge_completed(older_than=604800)

# Purge dead-lettered jobs older than 30 days
queue.purge_dead(older_than=2592000)
```

After purging, reclaim disk space:

```bash
sqlite3 myapp.db "VACUUM;"
```

!!! note
    `VACUUM` rewrites the entire database and requires exclusive access. Run it during low-traffic periods.

## High job latency

**Symptom**: Jobs sit in `pending` for longer than expected before starting.

**Diagnosis**: Check the queue depth and scheduler configuration.

```python
stats = queue.stats()
print(f"Pending: {stats['pending']}, Running: {stats['running']}")
```

**Possible causes and fixes**:

1. **Scheduler poll interval too high**: Default is 50ms. Jobs can wait up to one poll interval before being picked up.

    ```python
    queue = Queue(scheduler_poll_interval_ms=10)  # Poll every 10ms
    ```

    Lower values increase CPU/DB usage. Balance based on your latency requirements.

2. **Not enough workers**: All workers are busy. Increase the worker count.

    ```python
    queue = Queue(workers=16)
    ```

3. **Rate limiting**: The task or queue has a rate limit active.

    ```python
    # Check if rate limiting is the culprit
    # Rate-limited jobs are rescheduled 1 second into the future
    pending = queue.list_jobs(status="pending", limit=10)
    for job in pending:
        print(job.to_dict()["scheduled_at"])
    ```

4. **Database performance**: Slow dequeue queries. Check SQLite WAL size or Postgres query plans.

## Memory usage growing

**Symptom**: Worker process memory climbs over time.

**Causes**:

1. **Large result payloads**: Task return values are stored in the database but also held in the scheduler's result buffer briefly. If tasks return large objects (images, dataframes), memory spikes.

    Fix: Return a reference (file path, object key) instead of the data itself.

    ```python
    # Bad — large result stored in memory and DB
    @queue.task()
    def process_image(path: str) -> bytes:
        return open(path, "rb").read()

    # Good — return a path
    @queue.task()
    def process_image(path: str) -> str:
        out = path + ".processed"
        # ... write output to out ...
        return out
    ```

2. **Accumulated job records**: Without `result_ttl`, the database grows unbounded. See [Database growing too large](#database-growing-too-large).

3. **Resource leaks in tasks**: A task opens a file or connection and never closes it. Use context managers.

## Periodic task running twice

**Symptom**: A periodic task fires more than once per interval, or appears to run on two workers simultaneously.

**Behavior**: This is safe by design. Periodic tasks use `unique_key` deduplication — when a periodic task is due, each worker's scheduler checks and tries to enqueue it, but only one enqueue succeeds because the `unique_key` constraint prevents duplicates.

If you see two completed jobs for the same periodic task in the same interval, check:

```python
# Look for duplicate completions
jobs = queue.list_jobs(status="complete", limit=50)
periodic_jobs = [j for j in jobs if "daily_report" in j.to_dict()["task_name"]]
for j in periodic_jobs:
    print(j.to_dict()["completed_at"])
```

If you're genuinely seeing duplicate execution, ensure all workers use the same database (same SQLite file path or same Postgres DSN).

## Task not found in worker

**Symptom**: Worker logs `TaskNotFound` or jobs fail with an error like `unknown task: myapp.tasks.process`.

**Cause**: The task name registered at enqueue time doesn't match what the worker has registered.

Task names default to `module.function_name`. If you enqueue from one module path and run the worker with a different import path, the names won't match.

**Diagnosis**:

```python
# Check the task name stored in the job
job = queue.get_job(job_id)
print(job.to_dict()["task_name"])  # e.g. "myapp.tasks.process"

# Check what the worker has registered
# (add this temporarily to your worker startup)
print(list(queue._task_registry.keys()))
```

**Fix**: Use consistent import paths. If the task is `myapp/tasks.py:process`, always import it as `myapp.tasks.process` — not `tasks.process` (relative) or `src.myapp.tasks.process` (with src prefix).

You can also set an explicit name to decouple the task name from the module path:

```python
@queue.task(name="process-data")
def process(payload):
    ...
```
