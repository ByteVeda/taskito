# Integrations

taskito offers optional extras for popular frameworks and observability tools. Install only what you need.

## Available Integrations

| Extra | Install | What you get |
|-------|---------|--------------|
| **Flask** | `pip install taskito[flask]` | `Taskito(app)` extension, `flask taskito worker` CLI |
| **FastAPI** | `pip install taskito[fastapi]` | `TaskitoRouter` for instant REST API over the queue |
| **Django** | `pip install taskito[django]` | Admin integration, management commands |
| **OpenTelemetry** | `pip install taskito[otel]` | Distributed tracing with span-per-task |
| **Prometheus** | `pip install taskito[prometheus]` | `PrometheusMiddleware`, queue depth gauges, `/metrics` server |
| **Sentry** | `pip install taskito[sentry]` | `SentryMiddleware` with auto error capture and task tags |
| **Encryption** | `pip install taskito[encryption]` | `EncryptedSerializer` for at-rest payload encryption |
| **MsgPack** | `pip install taskito[msgpack]` | `MsgpackSerializer` for compact binary serialization |
| **Postgres** | `pip install taskito[postgres]` | Multi-machine workers via PostgreSQL backend |
| **Redis** | `pip install taskito[redis]` | Redis storage backend |

## Framework Integrations

- **[Flask](flask.md)** — Full Flask extension with app config, factory pattern, and CLI commands
- **[FastAPI](fastapi.md)** — Pre-built `APIRouter` with job status, SSE progress, and DLQ management
- **[Django](django.md)** — Admin views for browsing jobs, dead letters, and queue stats

## Observability Integrations

- **[OpenTelemetry](otel.md)** — Distributed tracing with per-task spans
- **[Prometheus](prometheus.md)** — Counters, histograms, and gauges for task execution
- **[Sentry](sentry.md)** — Automatic error capture with task context

## Combining Integrations

All middleware-based integrations (`OpenTelemetryMiddleware`, `PrometheusMiddleware`, `SentryMiddleware`) compose together:

```python
from taskito import Queue
from taskito.contrib.otel import OpenTelemetryMiddleware
from taskito.contrib.prometheus import PrometheusMiddleware
from taskito.contrib.sentry import SentryMiddleware

queue = Queue(
    db_path="myapp.db",
    middleware=[
        OpenTelemetryMiddleware(),
        PrometheusMiddleware(),
        SentryMiddleware(),
    ],
)
```
