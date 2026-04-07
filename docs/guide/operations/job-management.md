# Job Management

Manage running jobs — cancel, pause queues, archive, revoke, replay, and clean up.

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

### Maintenance Window Example

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

### Scheduled Archival

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

### Retry from Dead Letter with Replay

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
