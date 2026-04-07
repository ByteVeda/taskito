# Sentry Integration

taskito provides a `SentryMiddleware` that automatically captures task errors and sets rich context for Sentry.

## Installation

```bash
pip install taskito[sentry]
```

This installs `sentry-sdk` as a dependency.

## Setup

Initialize the Sentry SDK as usual, then add `SentryMiddleware` to your queue:

```python
import sentry_sdk
from taskito import Queue
from taskito.contrib.sentry import SentryMiddleware

sentry_sdk.init(dsn="https://examplePublicKey@o0.ingest.sentry.io/0")

queue = Queue(db_path="myapp.db", middleware=[SentryMiddleware()])
```

## What It Does

### Scope Tags

Each task execution gets a Sentry scope with the following tags (prefix customizable via `tag_prefix`):

| Tag | Value |
|-----|-------|
| `taskito.task_name` | The registered task name |
| `taskito.job_id` | The job ID |
| `taskito.queue` | The queue name |
| `taskito.retry_count` | Current retry attempt |

### Transaction Name

The Sentry transaction is set to `taskito:<task_name>` by default. Customizable via `transaction_name_fn`.

### Automatic Error Capture

When a task raises an exception, `SentryMiddleware` calls `sentry_sdk.capture_exception()` automatically. The exception appears in Sentry with all the context tags attached.

### Retry Breadcrumbs

When a task is retried, a breadcrumb is added with:

- **Category**: `taskito` (matches `tag_prefix`)
- **Level**: `warning`
- **Message**: `Retrying <task_name> (attempt <N>): <error>`

This gives you a trail of retry attempts leading up to a final failure.

## Configuration

```python
SentryMiddleware(
    tag_prefix="myapp",
    transaction_name_fn=lambda ctx: f"task-{ctx.task_name}",
    task_filter=lambda name: not name.startswith("internal."),
    extra_tags_fn=lambda ctx: {"worker.host": socket.gethostname()},
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `tag_prefix` | `str` | `"taskito"` | Prefix for Sentry tag keys and breadcrumb category. |
| `transaction_name_fn` | `Callable[[JobContext], str] | None` | `None` | Custom transaction name builder. Receives `JobContext`. Defaults to `<prefix>:<task_name>`. |
| `task_filter` | `Callable[[str], bool] | None` | `None` | Predicate on task name. Return `True` to report, `False` to skip. `None` reports all tasks. |
| `extra_tags_fn` | `Callable[[JobContext], dict[str, str]] | None` | `None` | Returns extra Sentry tags to set. Receives `JobContext`. |

## Combining with Other Middleware

`SentryMiddleware` composes with other observability middleware:

```python
from taskito.contrib.otel import OpenTelemetryMiddleware
from taskito.contrib.prometheus import PrometheusMiddleware

queue = Queue(
    db_path="myapp.db",
    middleware=[
        OpenTelemetryMiddleware(),
        PrometheusMiddleware(),
        SentryMiddleware(),
    ],
)
```

See the [Middleware guide](../guide/extensibility/middleware.md) for more on combining middleware.

## Full Example

```python
import sentry_sdk
from taskito import Queue
from taskito.contrib.sentry import SentryMiddleware

# Initialize Sentry first
sentry_sdk.init(
    dsn="https://examplePublicKey@o0.ingest.sentry.io/0",
    traces_sample_rate=1.0,
)

# Create queue with Sentry middleware
queue = Queue(db_path="myapp.db", middleware=[SentryMiddleware()])

@queue.task(max_retries=3)
def process_payment(order_id: str, amount: float):
    """Process a payment — errors are automatically reported to Sentry."""
    result = payment_gateway.charge(order_id, amount)
    if not result.success:
        raise PaymentError(f"Payment failed: {result.error}")
    return result.transaction_id
```

When `process_payment` fails:

1. The error appears in Sentry with tags `taskito.task_name=myapp.tasks.process_payment`, `taskito.job_id=...`, `taskito.queue=default`
2. If the task retries, each retry is recorded as a breadcrumb
3. The final failure (after all retries) includes the full breadcrumb trail
