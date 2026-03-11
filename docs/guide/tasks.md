# Tasks

Tasks are Python functions registered with a queue via the `@queue.task()` decorator.

## Defining a Task

```python
from taskito import Queue

queue = Queue(db_path="myapp.db")

@queue.task()
def process_data(data: dict) -> str:
    # Your logic here
    return "done"
```

## Decorator Options

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | `str \| None` | Auto-generated | Explicit task name. Defaults to `module.qualname`. |
| `max_retries` | `int` | `3` | Max retry attempts before moving to DLQ. |
| `retry_backoff` | `float` | `1.0` | Base delay in seconds for exponential backoff. |
| `retry_delays` | `list[float] \| None` | `None` | Per-attempt delays in seconds, overrides backoff. e.g. `[1, 5, 30]`. |
| `timeout` | `int` | `300` | Max execution time in seconds (hard timeout). |
| `soft_timeout` | `float \| None` | `None` | Cooperative time limit in seconds; checked via `current_job.check_timeout()`. |
| `priority` | `int` | `0` | Default priority (higher = more urgent). |
| `rate_limit` | `str \| None` | `None` | Rate limit string, e.g. `"100/m"`. |
| `queue` | `str` | `"default"` | Named queue to submit to. |
| `circuit_breaker` | `dict \| None` | `None` | Circuit breaker config: `{"threshold": 5, "window": 60, "cooldown": 120}`. |
| `middleware` | `list[TaskMiddleware] \| None` | `None` | Per-task middleware, applied in addition to queue-level middleware. |
| `expires` | `float \| None` | `None` | Seconds until the job expires if not started. |

```python
@queue.task(
    name="emails.send",
    max_retries=5,
    retry_backoff=2.0,
    timeout=60,
    priority=10,
    rate_limit="100/m",
    queue="emails",
)
def send_email(to: str, subject: str, body: str):
    ...
```

### Custom Retry Delays

Use `retry_delays` to specify exact wait times between each retry attempt instead of exponential backoff:

```python
@queue.task(retry_delays=[1, 5, 30])  # 1s after 1st fail, 5s after 2nd, 30s after 3rd
def flaky_api_call():
    ...
```

### Soft Timeouts

A soft timeout raises `SoftTimeoutError` only when the task cooperatively checks:

```python
from taskito import current_job

@queue.task(timeout=300, soft_timeout=60)
def long_running(items):
    for item in items:
        current_job.check_timeout()  # raises SoftTimeoutError if soft_timeout exceeded
        process(item)
```

### Circuit Breakers

Automatically open a circuit after repeated failures and refuse new executions during the cooldown period:

```python
@queue.task(circuit_breaker={"threshold": 5, "window": 60, "cooldown": 120})
def call_external_api():
    ...
```

- `threshold`: number of failures to trip the breaker
- `window`: rolling time window in seconds
- `cooldown`: seconds the breaker stays open before allowing a retry

### Per-Task Middleware

Apply middleware to a specific task only:

```python
from taskito.contrib.sentry import SentryMiddleware

@queue.task(middleware=[SentryMiddleware()])
def important_task():
    ...
```

### Job Expiration

Skip jobs that weren't started within the deadline:

```python
@queue.task(expires=300)  # skip if not started within 5 minutes
def time_sensitive():
    ...
```

## Task Naming

By default, tasks are named using `module.qualname`:

```python
# In myapp/tasks.py
@queue.task()
def process():  # Named: myapp.tasks.process
    ...
```

You can override with an explicit name:

```python
@queue.task(name="my-custom-name")
def process():  # Named: my-custom-name
    ...
```

## Enqueuing Jobs

### `.delay()` — Quick Submit

Submit with default options:

```python
job = send_email.delay("user@example.com", "Hello", "World")
```

### `.apply_async()` — Full Control

Override any option at enqueue time:

```python
job = send_email.apply_async(
    args=("user@example.com", "Hello", "World"),
    priority=100,          # Override priority
    delay=3600,            # Run 1 hour from now
    queue="urgent-emails", # Override queue
    max_retries=10,        # Override retries
    timeout=120,           # Override timeout
    unique_key="welcome-user@example.com",  # Deduplicate
    metadata='{"source": "signup"}',        # Attach JSON metadata
)
```

### Direct Call

Calling a task directly runs it synchronously, bypassing the queue:

```python
result = send_email("user@example.com", "Hello", "World")  # Runs immediately
```

## Batch Enqueue

Enqueue many jobs in a single SQLite transaction:

```python
# Via task.map()
jobs = send_email.map([
    ("alice@example.com", "Hi", "Body"),
    ("bob@example.com", "Hi", "Body"),
    ("carol@example.com", "Hi", "Body"),
])

# Via queue.enqueue_many()
jobs = queue.enqueue_many(
    task_name=send_email.name,
    args_list=[("alice@example.com",), ("bob@example.com",)],
    kwargs_list=[{"subject": "Hi", "body": "Body"}] * 2,
)
```

## Metadata

Attach arbitrary JSON metadata to jobs:

```python
job = process.apply_async(
    args=(data,),
    metadata='{"user_id": 42, "source": "api"}',
)
```

Metadata is stored with the job and visible in dead letter queue entries.
