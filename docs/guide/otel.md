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

- **Span name**: `taskito.execute.<task_name>`
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

### Custom Tracer Name

By default, spans are created under the `"taskito"` tracer. Override with:

```python
OpenTelemetryMiddleware(tracer_name="my-service")
```

## Combining with Other Middleware

`OpenTelemetryMiddleware` is a standard `TaskMiddleware`, so it composes with other middleware:

```python
queue = Queue(middleware=[
    OpenTelemetryMiddleware(),
    MyLoggingMiddleware(),
])
```

See the [Middleware guide](middleware.md) for more on combining middleware.
