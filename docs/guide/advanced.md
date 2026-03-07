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
    Deduplication uses a partial unique index: `CREATE UNIQUE INDEX ... ON jobs(unique_key) WHERE unique_key IS NOT NULL AND status IN (0, 1)`. Only pending and running jobs participate. The check-and-insert is atomic (transaction-protected), so concurrent calls with the same `unique_key` are handled gracefully without race conditions.

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

### Cascade Cleanup

When jobs are purged — either manually via `purge_completed()` or automatically via `result_ttl` — their related child records are also deleted:

- Error history (`job_errors`)
- Task logs (`task_logs`)
- Task metrics (`task_metrics`)
- Job dependencies (`job_dependencies`)
- Replay history (`replay_history`)

This prevents orphaned records from accumulating when parent jobs are removed.

```python
# Manual purge — child records are cleaned up automatically
deleted = queue.purge_completed(older_than=3600)
print(f"Purged {deleted} jobs and their related records")

# With per-job TTL — cascade cleanup still applies
job = resize_image.apply_async(
    args=("photo.jpg",),
    result_ttl=600,  # This job's results expire after 10 minutes
)
# When this job is purged (after 10 min), its errors, logs,
# metrics, dependencies, and replay history are also removed.
```

!!! note
    Dead letter entries are **not** cascade-deleted — they have their own lifecycle managed by `purge_dead()`. Timestamp-based cleanup (`result_ttl`) of error history, logs, and metrics also continues to run independently, catching old records regardless of whether the parent job still exists.

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

## Queue Pause/Resume

Temporarily pause job processing on a queue without stopping the worker:

```python
# Pause the "emails" queue
queue.pause("emails")

# Check which queues are paused
print(queue.paused_queues())  # ["emails"]

# Resume processing
queue.resume("emails")
```

Paused queues still accept new jobs — they just won't be dequeued until resumed.

## Job Archival

Move old completed jobs to an archive table to keep the main jobs table lean:

```python
# Archive completed jobs older than 24 hours
archived_count = queue.archive(older_than=86400)
print(f"Archived {archived_count} jobs")

# Browse archived jobs
archived = queue.list_archived(limit=50, offset=0)
for job in archived:
    print(f"{job.id}: {job.task_name} ({job.status})")
```

Archived jobs are no longer returned by `queue.stats()` or `queue.list_jobs()`, but remain queryable via `queue.list_archived()`.

### Example: Maintenance Window

```python
# Before maintenance: pause all queues
for q in ["default", "emails", "reports"]:
    queue.pause(q)
print(f"Paused: {queue.paused_queues()}")

# ... perform maintenance ...

# After maintenance: resume all queues
for q in ["default", "emails", "reports"]:
    queue.resume(q)
```

### Example: Scheduled Archival

```python
@queue.periodic(cron="0 0 2 * * *")  # Daily at 2 AM
def nightly_archival():
    archived = queue.archive(older_than=7 * 86400)  # Archive jobs older than 7 days
    current_job.log(f"Archived {archived} jobs")
```

## Task Revocation

Cancel all pending jobs for a specific task:

```python
# Revoke all pending "send_newsletter" jobs
cancelled = queue.revoke_task("myapp.tasks.send_newsletter")
print(f"Revoked {cancelled} jobs")
```

## Queue Purge

Remove all pending jobs from a specific queue:

```python
purged = queue.purge("emails")
print(f"Purged {purged} jobs from the emails queue")
```

## Job Replay

Replay a completed or dead job with the same arguments:

```python
new_job = queue.replay(job_id)
print(f"Replayed as {new_job.id}")

# Check replay history
history = queue.replay_history(job_id)
```

### Example: Retry from Dead Letter with Replay

```python
# List dead letters and replay them
dead = queue.dead_letters()
for entry in dead:
    print(f"Replaying dead job {entry['original_job_id']}: {entry['task_name']}")
    new_id = queue.retry_dead(entry["id"])
    print(f"  -> New job: {new_id}")
```

## SQLite Configuration

taskito configures SQLite for optimal performance:

| Pragma | Value | Purpose |
|---|---|---|
| `journal_mode` | WAL | Concurrent reads during writes |
| `busy_timeout` | 5000ms | Wait instead of failing on lock contention |
| `synchronous` | NORMAL | Balance between safety and speed |
| `journal_size_limit` | 64MB | Prevent unbounded WAL growth |

The connection pool uses up to 8 connections via `r2d2`.

## FastAPI Integration

taskito provides a first-class FastAPI integration via `taskito.contrib.fastapi`. It gives you a pre-built `APIRouter` with endpoints for job status, progress streaming via SSE, and dead letter queue management.

### Installation

```bash
pip install taskito[fastapi]
```

This installs `fastapi` and `pydantic` as extras.

### Quick Setup

```python
from fastapi import FastAPI
from taskito import Queue
from taskito.contrib.fastapi import TaskitoRouter

queue = Queue(db_path="myapp.db")

@queue.task()
def process_data(payload: dict) -> str:
    return "done"

app = FastAPI()
app.include_router(TaskitoRouter(queue), prefix="/tasks")
```

Run with:

```bash
uvicorn myapp:app --reload
```

All taskito endpoints are now available under `/tasks/`.

### Endpoints

The `TaskitoRouter` exposes the following endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/stats` | Queue statistics (pending, running, completed, etc.) |
| `GET` | `/jobs/{job_id}` | Job status, progress, and metadata |
| `GET` | `/jobs/{job_id}/errors` | Error history for a job |
| `GET` | `/jobs/{job_id}/result` | Job result (optional blocking with `?timeout=N`) |
| `GET` | `/jobs/{job_id}/progress` | SSE stream of progress updates |
| `POST` | `/jobs/{job_id}/cancel` | Cancel a pending job |
| `GET` | `/dead-letters` | List dead letter entries (paginated) |
| `POST` | `/dead-letters/{dead_id}/retry` | Re-enqueue a dead letter |

### Blocking Result Fetch

The `/jobs/{job_id}/result` endpoint supports an optional `timeout` query parameter (0–300 seconds). When `timeout > 0`, the request blocks until the job completes or the timeout elapses:

```bash
# Non-blocking (default)
curl http://localhost:8000/tasks/jobs/01H5K6X.../result

# Block up to 30 seconds for the result
curl http://localhost:8000/tasks/jobs/01H5K6X.../result?timeout=30
```

### SSE Progress Streaming

Stream real-time progress for a running job using Server-Sent Events:

```python
import httpx

with httpx.stream("GET", "http://localhost:8000/tasks/jobs/01H5K6X.../progress") as r:
    for line in r.iter_lines():
        print(line)
        # data: {"progress": 25, "status": "running"}
        # data: {"progress": 50, "status": "running"}
        # data: {"progress": 100, "status": "completed"}
```

From the browser:

```javascript
const source = new EventSource("/tasks/jobs/01H5K6X.../progress");
source.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`Progress: ${data.progress}%`);
  if (data.status === "completed" || data.status === "failed") {
    source.close();
  }
};
```

The stream sends a JSON event every 0.5 seconds while the job is active, then a final event when the job reaches a terminal state.

### Pydantic Response Models

All endpoints return validated Pydantic models with clean OpenAPI docs. You can import them for type-safe client code:

```python
from taskito.contrib.fastapi import (
    StatsResponse,
    JobResponse,
    JobErrorResponse,
    JobResultResponse,
    CancelResponse,
    DeadLetterResponse,
    RetryResponse,
)
```

### Custom Tags and Dependencies

Customize the router with FastAPI tags and dependency injection:

```python
from fastapi import Depends, FastAPI, Header, HTTPException
from taskito.contrib.fastapi import TaskitoRouter

async def verify_api_key(x_api_key: str = Header(...)):
    if x_api_key != "secret":
        raise HTTPException(status_code=401, detail="Invalid API key")

app = FastAPI()

router = TaskitoRouter(
    queue,
    tags=["task-queue"],              # OpenAPI tags
    dependencies=[Depends(verify_api_key)],  # Applied to all endpoints
)

app.include_router(router, prefix="/tasks")
```

### Full Example

```python
from fastapi import FastAPI, Header, HTTPException, Depends
from taskito import Queue, current_job
from taskito.contrib.fastapi import TaskitoRouter

queue = Queue(db_path="myapp.db")

@queue.task()
def resize_image(image_url: str, sizes: list[int]) -> dict:
    results = {}
    for i, size in enumerate(sizes):
        results[size] = do_resize(image_url, size)
        current_job.update_progress(int((i + 1) / len(sizes) * 100))
    return results

async def require_auth(authorization: str = Header(...)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(401)

app = FastAPI(title="Image Service")
app.include_router(
    TaskitoRouter(queue, dependencies=[Depends(require_auth)]),
    prefix="/tasks",
    tags=["tasks"],
)

# Start worker in a separate process:
#   taskito worker --app myapp:queue
```

```bash
# Check job status
curl http://localhost:8000/tasks/jobs/01H5K6X... \
  -H "Authorization: Bearer mytoken"

# Stream progress
curl -N http://localhost:8000/tasks/jobs/01H5K6X.../progress \
  -H "Authorization: Bearer mytoken"

# Block for result (up to 60s)
curl http://localhost:8000/tasks/jobs/01H5K6X.../result?timeout=60 \
  -H "Authorization: Bearer mytoken"
```
