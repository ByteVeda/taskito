# Queues & Priority

## Named Queues

Route tasks to different queues for isolation and dedicated processing:

```python
@queue.task(queue="emails")
def send_email(to, subject, body):
    ...

@queue.task(queue="reports")
def generate_report(report_id):
    ...

@queue.task()  # Goes to "default" queue
def process_data(data):
    ...
```

### Worker Queue Subscription

Workers can listen to specific queues:

```bash
# Process only email tasks
taskito worker --app myapp:queue --queues emails

# Process multiple queues
taskito worker --app myapp:queue --queues emails,reports

# Process all registered queues (default)
taskito worker --app myapp:queue
```

Or programmatically:

```python
queue.run_worker(queues=["emails", "reports"])
```

!!! tip "Use queues to isolate workloads"
    Separate I/O-bound tasks (API calls, emails) from CPU-bound tasks (data processing, report generation) into different queues. Run them on different worker processes for optimal resource usage.

## Priority

Higher priority jobs are dequeued first within the same queue. Priority is an integer — higher values mean more urgent.

### Default Priority

Set at task registration:

```python
@queue.task(priority=10)
def urgent_task(data):
    ...

@queue.task(priority=0)  # Default
def normal_task(data):
    ...
```

### Override at Enqueue Time

```python
# This specific job is extra urgent
urgent_task.apply_async(args=(data,), priority=100)
```

### How It Works

Jobs are dequeued using a compound index: `(queue, status, priority DESC, scheduled_at ASC)`. This means:

1. Higher priority jobs go first
2. Among equal priority, older jobs (earlier `scheduled_at`) go first
3. Each queue is processed independently

```python
# These three jobs are in the same queue
low = task.apply_async(args=(1,), priority=1)
mid = task.apply_async(args=(2,), priority=5)
high = task.apply_async(args=(3,), priority=10)

# Processing order: high (10), mid (5), low (1)
```

## Queue-Level Limits

Apply a rate limit or concurrency cap to an entire queue, independently of per-task settings. These limits are checked in the scheduler before any per-task limits.

### Rate limiting a queue

```python
queue.set_queue_rate_limit("default", "100/m")   # Max 100 jobs per minute
queue.set_queue_rate_limit("emails", "20/s")      # Max 20 emails per second
```

The format is the same as `rate_limit` on `@queue.task()`: `"N/s"`, `"N/m"`, or `"N/h"`.

### Capping concurrency per queue

```python
queue.set_queue_concurrency("default", 10)   # Max 10 jobs running at once
queue.set_queue_concurrency("reports", 2)    # Heavy tasks: max 2 at a time
```

`set_queue_concurrency` limits how many jobs from that queue run simultaneously across all workers.

!!! tip "Queue limits vs task limits"
    Queue-level limits apply to all tasks in the queue regardless of their individual settings. Per-task `rate_limit` and `max_concurrent` are checked afterwards and may impose stricter caps. Set queue limits to protect shared downstream resources (APIs, databases) and per-task limits to manage individual task capacity.

Both methods can be called at any point before or after `run_worker()` starts.

## Default Queue Settings

Configure defaults at the Queue level:

```python
queue = Queue(
    db_path="myapp.db",
    default_priority=0,    # Default priority for all tasks
    default_retry=3,       # Default max retries
    default_timeout=300,   # Default timeout in seconds
)
```

Individual `@queue.task()` decorators override these defaults.
