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
| `*/30 * * * * *` | Every 30 seconds |
| `0 */5 * * * *` | Every 5 minutes |
| `0 0 * * * *` | Every hour |
| `0 30 * * * *` | Every hour at :30 |
| `0 0 */2 * * *` | Every 2 hours |
| `0 0 0 * * *` | Every day at midnight |
| `0 0 9 * * *` | Every day at 9:00 AM |
| `0 0 9 * * 1-5` | Weekdays at 9:00 AM |
| `0 30 9 * * 1-5` | Weekdays at 9:30 AM |
| `0 0 0 1 * *` | First day of every month at midnight |
| `0 0 0 * * 0` | Every Sunday at midnight |
| `0 0 0 1 1 *` | January 1st at midnight (yearly) |

### Decorator Options

```python
@queue.periodic(
    cron="0 0 * * * *",           # Required: cron expression
    name="hourly-cleanup",         # Optional: explicit name
    args=(3600,),                  # Optional: positional args
    kwargs={"force": True},        # Optional: keyword args
    queue="maintenance",           # Optional: target queue
    timezone="America/New_York",   # Optional: IANA timezone (default: UTC)
)
def cleanup(older_than, force=False):
    ...
```

### Timezone Support

By default, cron expressions are evaluated in UTC. Pass any IANA timezone name to schedule in a specific timezone:

```python
@queue.periodic(cron="0 0 9 * * 1-5", timezone="America/New_York")
def morning_report():
    """Run weekdays at 9:00 AM Eastern."""
    generate_report()

@queue.periodic(cron="0 0 18 * * *", timezone="Europe/London")
def end_of_day_summary():
    """Run at 6:00 PM London time."""
    send_summary()
```

Timezone handling uses `chrono-tz` under the hood. Daylight saving time transitions are handled automatically. The `timezone` parameter defaults to UTC when omitted.

### How Periodic Tasks Work

1. Periodic tasks are registered with the Rust scheduler when the worker starts
2. The scheduler checks for due tasks every ~3 seconds
3. When a task is due, a new job is enqueued automatically
4. The task's `next_run` is computed using the cron expression
5. Periodic task state is persisted in the `periodic_tasks` SQLite table

!!! note
    Periodic tasks are only active while a worker is running. If no worker is running, tasks accumulate and the **next due** job is enqueued when a worker starts.

## Edge Cases

### Task takes longer than the interval

If a periodic task's execution time exceeds its cron interval, the next run is **skipped**, not stacked. Periodic tasks use `unique_key` deduplication internally — if the previous run is still pending or running, the new enqueue is silently dropped.

### Multiple workers running periodic tasks

Safe by design. Each worker's scheduler checks for due periodic tasks independently, but they all use the same `unique_key` for deduplication. Only one instance of each periodic task runs at a time, regardless of how many workers are active.

### Timezone handling

```python
@queue.periodic(cron="0 9 * * *", timezone="America/New_York")
def morning_report():
    ...
```

Without `timezone`, cron expressions are evaluated in **UTC**. Specify a timezone string (any valid [IANA timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)) to schedule in local time. Daylight saving transitions are handled automatically via `chrono-tz`.
