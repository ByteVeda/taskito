# Monitoring & Hooks

## Queue Statistics

Get a snapshot of job counts by status:

```python
stats = queue.stats()
# {'pending': 12, 'running': 3, 'completed': 450, 'failed': 2, 'dead': 1, 'cancelled': 0}
```

Async variant:

```python
stats = await queue.astats()
```

## CLI Monitoring

### One-Shot Stats

```bash
quickq info --app myapp:queue
```

```
quickq queue statistics
------------------------------
  pending      12
  running      3
  completed    450
  failed       2
  dead         1
  cancelled    0
------------------------------
  total        468
```

### Live Dashboard

```bash
quickq info --app myapp:queue --watch
```

Refreshes every 2 seconds with throughput calculation (completed jobs per second).

## Progress Tracking

Report progress from inside tasks using `current_job`:

```python
from quickq import current_job

@queue.task()
def process_batch(items):
    total = len(items)
    for i, item in enumerate(items):
        process(item)
        current_job.update_progress(int((i + 1) / total * 100))
    return f"Processed {total} items"
```

Read progress from outside:

```python
job = process_batch.delay(items)

# Poll progress
fetched = queue.get_job(job.id)
print(fetched.progress)  # 0-100 or None
```

### Job Context

Inside a running task, `current_job` provides:

| Property | Type | Description |
|---|---|---|
| `current_job.id` | `str` | The current job ID |
| `current_job.task_name` | `str` | The registered task name |
| `current_job.retry_count` | `int` | Current retry attempt (0 = first run) |
| `current_job.queue_name` | `str` | The queue this job is running on |

```python
from quickq import current_job

@queue.task()
def my_task():
    print(f"Running job {current_job.id}")
    print(f"Task: {current_job.task_name}")
    print(f"Attempt: {current_job.retry_count}")
    print(f"Queue: {current_job.queue_name}")
```

!!! warning
    `current_job` properties raise `RuntimeError` when accessed outside of a running task.

## Hooks

Run code before/after every task, or on success/failure.

### `@queue.before_task`

Called before each task executes:

```python
@queue.before_task
def log_start(task_name, args, kwargs):
    print(f"[START] {task_name}")
```

### `@queue.after_task`

Called after each task, regardless of success or failure:

```python
@queue.after_task
def log_end(task_name, args, kwargs, result, error):
    status = "OK" if error is None else f"FAILED: {error}"
    print(f"[END] {task_name} - {status}")
```

### `@queue.on_success`

Called only when a task succeeds:

```python
@queue.on_success
def track_metrics(task_name, args, kwargs, result):
    metrics.increment(f"task.{task_name}.success")
```

### `@queue.on_failure`

Called only when a task raises an exception:

```python
@queue.on_failure
def alert_on_error(task_name, args, kwargs, error):
    sentry_sdk.capture_exception(error)
```

### Hook Signatures

| Hook | Signature |
|---|---|
| `before_task` | `fn(task_name, args, kwargs)` |
| `after_task` | `fn(task_name, args, kwargs, result, error)` |
| `on_success` | `fn(task_name, args, kwargs, result)` |
| `on_failure` | `fn(task_name, args, kwargs, error)` |

!!! tip "Multiple hooks"
    You can register multiple hooks of the same type. They execute in registration order.
