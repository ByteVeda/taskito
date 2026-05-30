<div align="center">

# taskito

A Rust-powered task queue for Python. No broker required — just SQLite or Postgres.

[![PyPI version](https://img.shields.io/pypi/v/taskito.svg)](https://pypi.org/project/taskito/)
[![Python versions](https://img.shields.io/pypi/pyversions/taskito.svg)](https://pypi.org/project/taskito/)
[![License](https://img.shields.io/pypi/l/taskito.svg)](https://github.com/ByteVeda/taskito/blob/master/LICENSE)

</div>

```
pip install taskito                # SQLite (default)
pip install taskito[postgres]      # with Postgres backend
```

## Quickstart

**1. Define tasks** in `tasks.py`:

```python
from taskito import Queue

queue = Queue(db_path="tasks.db")

@queue.task()
def add(a: int, b: int) -> int:
    return a + b
```

**2. Start a worker:**

```bash
taskito worker --app tasks:queue
```

**3. Enqueue jobs:**

```python
from tasks import add

job = add.delay(2, 3)
print(job.result(timeout=10))  # 5
```

## Why taskito?

Most Python task queues need a separate broker (Redis, RabbitMQ) even for single-machine
workloads. taskito embeds storage, scheduling, and worker management into one `pip install`
with no external services. An optional Postgres backend adds multi-machine workers with the
same API.

The engine runs in Rust — a Tokio async scheduler, an OS-thread worker pool, and Diesel over
SQLite in WAL mode. The GIL is held only during task execution; run `--pool prefork` for true
parallelism on CPU-bound work.

## Features

- **Reliability** — retries with exponential backoff, dead letter queue with replay, circuit breakers, exception filtering
- **Scheduling** — priorities, rate limiting, periodic (cron) tasks, delayed execution, job expiration
- **Workflows** — `chain` / `group` / `chord`, task dependencies with cascade cancel
- **Control** — cooperative cancellation, soft timeouts, unique/idempotent tasks, queue pause/resume
- **Observability** — web dashboard, events, HMAC-signed webhooks, structured logging, worker heartbeats
- **Extensibility** — pluggable serializers, per-task middleware, async API, Postgres/Redis backends

## Examples

```python
from taskito import chain, group, chord

# Sequential pipeline — each step receives the previous result
chain(fetch.s(url), parse.s(), store.s()).apply()

# Parallel fan-out, then a callback once all complete
chord([download.s(u) for u in urls], merge.s()).apply()
```

```python
@queue.task(max_retries=5, retry_backoff=2.0, rate_limit="100/m")
def fetch_url(url: str) -> str:
    return requests.get(url).text
```

More examples — dependencies, progress tracking, middleware, FastAPI — in the
**[docs](https://docs.byteveda.org/taskito)**.

## Integrations

| Extra | Install | What you get |
|-------|---------|--------------|
| **Flask** | `pip install taskito[flask]` | `Taskito(app)` extension, `flask taskito worker` CLI |
| **FastAPI** | `pip install taskito[fastapi]` | `TaskitoRouter` for instant REST API over the queue |
| **Django** | `pip install taskito[django]` | Admin integration, management commands |
| **OpenTelemetry** | `pip install taskito[otel]` | Distributed tracing with span-per-task |
| **Prometheus** | `pip install taskito[prometheus]` | `PrometheusMiddleware`, queue depth gauges, `/metrics` server |
| **Sentry** | `pip install taskito[sentry]` | `SentryMiddleware` with auto error capture and task tags |
| **Postgres** | `pip install taskito[postgres]` | Multi-machine workers via PostgreSQL backend |
| **Redis** | `pip install taskito[redis]` | Redis storage backend |

## Testing

Built-in test mode — no worker needed:

```python
def test_add():
    with queue.test_mode() as results:
        add.delay(2, 3)
        assert results[0].return_value == 5
```

## Documentation

**[Read the docs →](https://docs.byteveda.org/taskito)** — guides, API reference, and architecture.
Coming from Celery? See the **[Migration Guide](https://docs.byteveda.org/taskito/docs/guides/operations/migration)**.

## Comparison

| Feature | taskito | Celery | RQ | Dramatiq | Huey |
|---|---|---|---|---|---|
| Broker required | **No** | Yes | Yes | Yes | Yes |
| Core language | **Rust + Python** | Python | Python | Python | Python |
| Priority queues | **Yes** | Yes | No | No | Yes |
| Rate limiting | **Yes** | Yes | No | Yes | No |
| Dead letter queue | **Yes** | No | Yes | No | No |
| Task dependencies | **Yes** | No | No | No | No |
| Built-in dashboard | **Yes** | No | No | No | No |
| FastAPI integration | **Yes** | No | No | No | No |
| Cancel running tasks | **Yes** | Yes | No | No | No |
| Postgres backend | **Yes** | Yes | No | No | No |
| Setup | **`pip install`** | Broker + backend | Redis | Broker | Redis |

## License

MIT
