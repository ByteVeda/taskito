# Tasks

Tasks are Python functions registered with a queue via the `@queue.task()` decorator.

## Defining a Task

```python
from quickq import Queue

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
| `timeout` | `int` | `300` | Max execution time in seconds. |
| `priority` | `int` | `0` | Default priority (higher = more urgent). |
| `rate_limit` | `str \| None` | `None` | Rate limit string, e.g. `"100/m"`. |
| `queue` | `str` | `"default"` | Named queue to submit to. |

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
