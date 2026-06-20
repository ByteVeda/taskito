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

Grouped by what you're trying to do — each section has a one-line sample and a
link to its deep-dive guide. New here? Start with
**[Capabilities at a glance](https://docs.byteveda.org/taskito/capabilities)**.

### Reliability

Retries with exponential backoff, per-exception retry rules, soft timeouts, a
dead-letter queue with replay, circuit breakers, and idempotent enqueue.

```python
@queue.task(max_retries=5, retry_backoff=2.0, retry_on=[TimeoutError])
def fetch_url(url: str) -> str: ...
```

[→ Reliability guide](https://docs.byteveda.org/taskito/guides/reliability)

### Workflows

Compose tasks with `chain`, fan out with `group`, fan in with `chord` — plus
task dependency graphs with cascade cancel.

```python
chain(fetch.s(url), parse.s(), store.s()).apply()
```

[→ Workflows guide](https://docs.byteveda.org/taskito/guides/workflows/canvas)

### Concurrency

A thread pool by default (ideal for I/O-bound tasks); switch to a **prefork**
pool of child processes for true CPU parallelism with no GIL contention.

```bash
taskito worker --pool prefork --app tasks:queue   # CPU-bound: real parallelism
```

[→ Execution & prefork guide](https://docs.byteveda.org/taskito/guides/advanced-execution/prefork)

### Scheduling

Priorities, rate limiting, periodic (cron) tasks, delayed execution, and job
expiration.

```python
@queue.task(priority=9, rate_limit="100/m")
def notify(user_id: int) -> None: ...
```

[→ Scheduling guide](https://docs.byteveda.org/taskito/guides/core/scheduling)

### Observability

A built-in web dashboard, an events system, HMAC-signed webhooks, Prometheus and
OpenTelemetry exporters, structured logging, and worker heartbeats.

```bash
taskito dashboard --app tasks:queue   # Flower-style monitoring UI
```

[→ Dashboard & monitoring guide](https://docs.byteveda.org/taskito/guides/dashboard)

### Extensibility

Pluggable serializers, per-task middleware, a fully async API, and Postgres or
Redis backends for multi-machine workers.

```python
@queue.task(middleware=[MyMiddleware()])   # per-task hooks
def handle(payload: dict) -> None: ...
```

[→ Extensibility guide](https://docs.byteveda.org/taskito/guides/extensibility)

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
Coming from Celery? See the **[Migration Guide](https://docs.byteveda.org/taskito/guides/operations/migration)**.

## Comparison

| Feature | taskito | Celery | RQ | Dramatiq | Huey |
|---|---|---|---|---|---|
| Broker required | **No** | Yes | Yes | Yes | Yes |
| Core language | **Rust + Python** | Python | Python | Python | Python |
| Priority queues | **Yes** | Yes | No | No | Yes |
| Rate limiting | **Yes** | Yes | No | Yes | No |
| Dead letter queue | **Yes** | No | Yes | No | No |
| Task dependencies | **Yes** | No | No | No | No |
| Workflows (chain/group/chord) | **Yes** | Yes | No | Yes | No |
| Built-in dashboard | **Yes** | No | No | No | No |
| FastAPI integration | **Yes** | No | No | No | No |
| Cancel running tasks | **Yes** | Yes | No | No | No |
| CPU parallelism (prefork pool) | **Yes** | Yes | Yes | Yes | Yes |
| Postgres backend | **Yes** | Yes | No | No | No |
| Setup | **`pip install`** | Broker + backend | Redis | Broker | Redis |

## License

MIT
