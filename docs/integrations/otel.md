# OpenTelemetry Integration

taskito provides optional OpenTelemetry support for distributed tracing of task execution.

## Installation

Install with the `otel` extra:

```bash
pip install taskito[otel]
```

This installs `opentelemetry-api` as a dependency.

## Setup

Add `OpenTelemetryMiddleware` to your queue:

```python
from taskito import Queue
from taskito.contrib.otel import OpenTelemetryMiddleware

queue = Queue(middleware=[OpenTelemetryMiddleware()])
```

## What Gets Traced

Each task execution produces a span with:

- **Span name**: `taskito.execute.<task_name>` (customizable)
- **Attributes**:
    - `taskito.job_id` — the job ID
    - `taskito.task_name` — the registered task name
    - `taskito.queue` — the queue name
    - `taskito.retry_count` — current retry attempt
- **Status**: `OK` on success, `ERROR` on failure (with exception recorded)
- **Events**: A `retry` event is added when a task is about to be retried

## Configuration with Exporters

`OpenTelemetryMiddleware` uses the standard OpenTelemetry API, so configure exporters as you normally would:

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# Set up the tracer provider with an OTLP exporter
provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

# Now create your queue — spans will be exported automatically
from taskito import Queue
from taskito.contrib.otel import OpenTelemetryMiddleware

queue = Queue(middleware=[OpenTelemetryMiddleware()])
```

## Configuration

`OpenTelemetryMiddleware` accepts several options to customize how spans are created:

```python
OpenTelemetryMiddleware(
    tracer_name="my-service",
    span_name_fn=lambda ctx: f"task/{ctx.task_name}",
    attribute_prefix="myapp",
    extra_attributes_fn=lambda ctx: {"deployment.env": "prod"},
    task_filter=lambda name: not name.startswith("internal."),
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `tracer_name` | `str` | `"taskito"` | OpenTelemetry tracer name. |
| `span_name_fn` | `Callable[[JobContext], str] \| None` | `None` | Custom span name builder. Receives `JobContext`, returns a string. Defaults to `<prefix>.execute.<task_name>`. |
| `attribute_prefix` | `str` | `"taskito"` | Prefix for all span attribute keys. |
| `extra_attributes_fn` | `Callable[[JobContext], dict] \| None` | `None` | Returns extra attributes to add to each span. Receives `JobContext`. |
| `task_filter` | `Callable[[str], bool] \| None` | `None` | Predicate that receives a task name. Return `True` to trace, `False` to skip. `None` traces all tasks. |

## Combining with Other Middleware

`OpenTelemetryMiddleware` is a standard `TaskMiddleware`, so it composes with other middleware:

```python
queue = Queue(middleware=[
    OpenTelemetryMiddleware(),
    MyLoggingMiddleware(),
])
```

!!! note "Thread safety"
    `OpenTelemetryMiddleware` is thread-safe and can be used with multi-worker configurations. Internal span tracking is protected by a lock.

See the [Middleware guide](../guide/middleware.md) for more on combining middleware.
