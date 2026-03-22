# Per-Task Middleware

taskito supports a middleware system that lets you run code at key points in the task lifecycle. Middleware can be applied globally (to all tasks) or per-task.

## TaskMiddleware Base Class

Create middleware by subclassing `TaskMiddleware` and overriding the hooks you need:

```python
from taskito import TaskMiddleware

class LoggingMiddleware(TaskMiddleware):
    def before(self, ctx):
        print(f"[START] {ctx.task_name} (job {ctx.id})")

    def after(self, ctx, result, error):
        status = "OK" if error is None else f"FAILED: {error}"
        print(f"[END] {ctx.task_name}: {status}")

    def on_retry(self, ctx, error, retry_count):
        print(f"[RETRY] {ctx.task_name} attempt {retry_count}: {error}")
```

### Hook Signatures

| Hook | Called when |
|---|---|
| `before(ctx)` | Before task execution |
| `after(ctx, result, error)` | After task execution (success or failure) |
| `on_retry(ctx, error, retry_count)` | A job fails and will be retried |
| `on_enqueue(task_name, args, kwargs, options)` | A job is about to be enqueued |
| `on_dead_letter(ctx, error)` | A job exhausts all retries and moves to the DLQ |
| `on_timeout(ctx)` | A job hits its timeout limit |
| `on_cancel(ctx)` | A job is cancelled during execution |

The `ctx` parameter is a `JobContext` — the same object as `current_job` — providing `ctx.id`, `ctx.task_name`, `ctx.retry_count`, and `ctx.queue_name`.

!!! note "Lifecycle hooks dispatched from Rust"
    `on_retry`, `on_dead_letter`, `on_timeout`, and `on_cancel` are called by the Rust result handler after the scheduler records the outcome. They fire after `after()` and after the corresponding event is emitted on the event bus. Exceptions raised inside these hooks are logged and do not affect job processing.

### `on_timeout` — Handling Timed-Out Jobs

`on_timeout` fires when the Rust scheduler detects a stale job that exceeded its hard `timeout`. Detection happens in the maintenance reaper, which periodically scans for jobs still marked as running past their deadline.

When a job times out, `on_timeout` is called **before** `on_retry` (if the job will be retried) or `on_dead_letter` (if retries are exhausted). This lets you react to the timeout itself independently of whether the job will be retried:

```python
class TimeoutAlerter(TaskMiddleware):
    def on_timeout(self, ctx):
        # Fires for every timed-out job, regardless of retry/DLQ outcome
        logger.error("Job %s (%s) timed out", ctx.id, ctx.task_name)

    def on_retry(self, ctx, error, retry_count):
        # Fires after on_timeout when the job will be retried
        logger.warning("Retrying %s (attempt %d)", ctx.task_name, retry_count)

    def on_dead_letter(self, ctx, error):
        # Fires after on_timeout when retries are exhausted
        logger.critical("Job %s exhausted retries after timeout", ctx.id)
```

!!! tip
    Use `on_timeout` to update dashboards, fire alerts, or record SLA violations. Combine with `on_retry` and `on_dead_letter` for full visibility into the job's fate after the timeout.

### `on_enqueue` — Modifying Enqueue Parameters

`on_enqueue` is unique: it fires before the job is written to the database, and the `options` dict is **mutable**. Modify it to change how the job is enqueued:

```python
class PriorityBoostMiddleware(TaskMiddleware):
    def on_enqueue(self, task_name, args, kwargs, options):
        # Bump priority for urgent tasks during business hours
        import datetime
        hour = datetime.datetime.now().hour
        if 9 <= hour < 18 and task_name.startswith("alerts."):
            options["priority"] = max(options.get("priority", 0), 50)
```

Keys present in `options`: `priority`, `delay`, `queue`, `max_retries`, `timeout`, `unique_key`, `metadata`.

## Queue-Level Middleware

Apply middleware to **all tasks** by passing it to the `Queue` constructor:

```python
from taskito import Queue

queue = Queue(middleware=[LoggingMiddleware()])
```

## Per-Task Middleware

Apply middleware to a **specific task** using the `middleware` parameter:

```python
@queue.task(middleware=[MetricsMiddleware()])
def process(data):
    ...
```

Per-task middleware runs **after** global middleware, in registration order.

## Example: Metrics Middleware

```python
import time
from taskito import TaskMiddleware

class MetricsMiddleware(TaskMiddleware):
    def before(self, ctx):
        ctx._start_time = time.monotonic()

    def after(self, ctx, result, error):
        elapsed = time.monotonic() - ctx._start_time
        status = "success" if error is None else "failure"
        metrics.histogram("task.duration_seconds", elapsed, tags={
            "task": ctx.task_name,
            "status": status,
        })
```

## Composition and Ordering

### Multiple middleware on the same task

```python
import time
from taskito import TaskMiddleware

class TimingMiddleware(TaskMiddleware):
    def before(self, ctx):
        ctx._start = time.monotonic()
    def after(self, ctx, result, error):
        elapsed = time.monotonic() - ctx._start
        print(f"{ctx.task_name} took {elapsed:.3f}s")

class LoggingMiddleware(TaskMiddleware):
    def before(self, ctx):
        print(f"Starting {ctx.task_name}[{ctx.id}]")
    def after(self, ctx, result, error):
        print(f"Finished {ctx.task_name}[{ctx.id}]")

@queue.task(middleware=[TimingMiddleware(), LoggingMiddleware()])
def process(data):
    ...
```

### Execution order

1. **Global middleware** (registered via `Queue(middleware=[...])`) runs first
2. **Per-task middleware** (via `@queue.task(middleware=[...])`) runs second
3. Within each group, middleware runs in **registration order**
4. `after()` hooks run in **reverse order** (like a stack)

### Exception handling

If a middleware hook raises an exception:

- **`before()`**: The exception is logged, but subsequent middleware `before()` hooks still run. The task executes normally.
- **`after()`**: The exception is logged. Other `after()` hooks still run.
- **`on_retry()` / `on_dead_letter()`**: Logged and swallowed — these are notification hooks, not control flow.

Middleware exceptions never prevent task execution or result handling.

## Middleware vs Hooks

taskito has two systems for running code around tasks:

| | Hooks (`@queue.on_failure`, etc.) | Middleware (`TaskMiddleware`) |
|---|---|---|
| **Scope** | Queue-level only | Queue-level or per-task |
| **Interface** | Decorated functions | Class with up to 7 hooks |
| **Context** | Receives `task_name, args, kwargs` | Receives `JobContext` |
| **Enqueue hook** | No | Yes (`on_enqueue`, can mutate options) |
| **Retry hook** | No | Yes (`on_retry`) |
| **DLQ / timeout / cancel hooks** | No | Yes |
| **Execution order** | After middleware | Before hooks |

Middleware runs **inside** the task wrapper (closer to the task function), while hooks run **outside**. In practice, middleware `before()` fires first, then `before_task` hooks. On completion, `on_success`/`on_failure` hooks fire, then middleware `after()`.

## Combining with OpenTelemetry

The built-in `OpenTelemetryMiddleware` is itself a `TaskMiddleware`, so it composes naturally with your own middleware:

```python
from taskito import Queue
from taskito.contrib.otel import OpenTelemetryMiddleware

queue = Queue(middleware=[
    OpenTelemetryMiddleware(),
    LoggingMiddleware(),
])
```

See the [OpenTelemetry guide](otel.md) for setup details.
