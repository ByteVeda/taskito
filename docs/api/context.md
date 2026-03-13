# Job Context

::: taskito.context

Per-job context for the currently executing task. Provides access to job metadata and controls from inside a running task.

## Usage

```python
from taskito.context import current_job

# or directly:
from taskito import current_job
```

`current_job` is a module-level singleton. It works in both sync and async tasks:

- **Sync tasks** — reads from `threading.local`, isolated per worker thread.
- **Async tasks** — reads from a `contextvars.ContextVar`, isolated per concurrent coroutine even when multiple async tasks run on the same event loop.

!!! warning
    `current_job` can only be used inside a running task. Accessing it outside a task raises `RuntimeError`.

## Properties

### `current_job.id`

```python
current_job.id -> str
```

The unique ID of the currently executing job.

```python
@queue.task()
def process(data):
    print(f"Running as job {current_job.id}")
    ...
```

### `current_job.task_name`

```python
current_job.task_name -> str
```

The registered name of the currently executing task.

### `current_job.retry_count`

```python
current_job.retry_count -> int
```

How many times this job has been retried. `0` on the first attempt.

```python
@queue.task(max_retries=3)
def flaky_task():
    if current_job.retry_count > 0:
        print(f"Retry attempt #{current_job.retry_count}")
    call_external_api()
```

### `current_job.queue_name`

```python
current_job.queue_name -> str
```

The name of the queue this job is running on.

## Methods

### `current_job.update_progress()`

```python
current_job.update_progress(progress: int) -> None
```

Update the job's progress percentage (0–100). The value is written directly to the database and can be read via [`job.progress`](result.md#jobprogress) or [`queue.get_job()`](queue.md#queueget_job).

```python
@queue.task()
def process_files(file_list):
    for i, path in enumerate(file_list):
        handle(path)
        current_job.update_progress(int((i + 1) / len(file_list) * 100))
```

Read progress from the caller:

```python
job = process_files.delay(files)

# Poll progress
import time
while job.status == "running":
    print(f"Progress: {job.progress}%")
    time.sleep(1)
```

## How It Works

**Sync tasks (thread pool):**

1. Before execution, the Rust worker calls `_set_context()` with the job's metadata
2. `current_job` reads from `threading.local` — each worker thread has independent storage
3. After the task completes (success or failure), `_clear_context()` resets the thread-local

**Async tasks (native async pool):**

1. Before execution, `set_async_context()` sets a `contextvars.ContextVar` token
2. `current_job` checks `contextvars` first; if a token is set it returns that context
3. After the coroutine finishes, `clear_async_context()` resets the token

This means concurrent async tasks on the same event loop each see their own isolated context — there is no cross-task interference.
