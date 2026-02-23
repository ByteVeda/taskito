# Scheduling

taskito supports both **delayed tasks** (run once in the future) and **periodic tasks** (run on a cron schedule).

## Delayed Tasks

Schedule a task to run after a delay:

```python
# Run 1 hour from now
send_email.apply_async(
    args=("user@example.com", "Reminder", "Don't forget!"),
    delay=3600,  # seconds
)

# Run 30 seconds from now
cleanup.apply_async(args=(), delay=30)
```

The job is created immediately with `status=pending` but won't be picked up by a worker until the `scheduled_at` timestamp is reached.

## Periodic Tasks

Register recurring tasks with cron expressions:

```python
@queue.periodic(cron="0 */5 * * * *")
def health_check():
    """Run every 5 minutes."""
    ping_services()

@queue.periodic(cron="0 0 0 * * *")
def daily_cleanup():
    """Run at midnight every day."""
    queue.purge_completed(older_than=86400)

@queue.periodic(cron="0 0 9 * * 1", args=("weekly",))
def weekly_report(report_type):
    """Run every Monday at 9:00 AM."""
    generate_report(report_type)
```

### Cron Expression Format

taskito uses **6-field cron expressions** (with seconds):

```
┌─────────── second (0-59)
│ ┌───────── minute (0-59)
│ │ ┌─────── hour (0-23)
│ │ │ ┌───── day of month (1-31)
│ │ │ │ ┌─── month (1-12)
│ │ │ │ │ ┌─ day of week (0-6, Sun=0)
│ │ │ │ │ │
* * * * * *
```

| Expression | Schedule |
|---|---|
| `0 */5 * * * *` | Every 5 minutes |
| `0 0 * * * *` | Every hour |
| `0 0 0 * * *` | Every day at midnight |
| `0 30 9 * * 1-5` | Weekdays at 9:30 AM |
| `0 0 */2 * * *` | Every 2 hours |
| `*/30 * * * * *` | Every 30 seconds |

### Decorator Options

```python
@queue.periodic(
    cron="0 0 * * * *",       # Required: cron expression
    name="hourly-cleanup",     # Optional: explicit name
    args=(3600,),              # Optional: positional args
    kwargs={"force": True},    # Optional: keyword args
    queue="maintenance",       # Optional: target queue
)
def cleanup(older_than, force=False):
    ...
```

### How Periodic Tasks Work

1. Periodic tasks are registered with the Rust scheduler when the worker starts
2. The scheduler checks for due tasks every ~3 seconds
3. When a task is due, a new job is enqueued automatically
4. The task's `next_run` is computed using the cron expression
5. Periodic task state is persisted in the `periodic_tasks` SQLite table

!!! note
    Periodic tasks are only active while a worker is running. If no worker is running, tasks accumulate and the **next due** job is enqueued when a worker starts.
