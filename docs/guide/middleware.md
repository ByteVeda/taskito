# Per-Task Middleware

taskito supports a middleware system that lets you run code before, after, and on retry of task executions. Middleware can be applied globally (to all tasks) or per-task.

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

| Hook | Signature | Called when |
|---|---|---|
| `before(ctx)` | `ctx: JobContext` | Before task execution |
| `after(ctx, result, error)` | `ctx: JobContext`, `result: Any`, `error: Exception \| None` | After task execution (success or failure) |
| `on_retry(ctx, error, retry_count)` | `ctx: JobContext`, `error: Exception`, `retry_count: int` | When a task is about to be retried |

The `ctx` parameter is a `JobContext` — the same object as `current_job` — providing `ctx.id`, `ctx.task_name`, `ctx.retry_count`, and `ctx.queue_name`.

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

## Middleware vs Hooks

taskito has two systems for running code around tasks:

| | Hooks (`@queue.on_failure`, etc.) | Middleware (`TaskMiddleware`) |
|---|---|---|
| **Scope** | Queue-level only | Queue-level or per-task |
| **Interface** | Decorated functions | Class with `before`/`after`/`on_retry` |
| **Context** | Receives `task_name, args, kwargs` | Receives `JobContext` |
| **Retry hook** | No | Yes (`on_retry`) |
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
