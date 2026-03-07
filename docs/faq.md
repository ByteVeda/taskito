# FAQ

## Can I use taskito with Django?

Yes. Create a `Queue` instance in one of your Django apps and import it where needed:

```python
# myproject/tasks.py
from taskito import Queue

queue = Queue(db_path="taskito.db")

@queue.task()
def send_welcome_email(user_id: int):
    from myapp.models import User
    user = User.objects.get(id=user_id)
    user.email_user("Welcome!", "Thanks for signing up.")
```

Import tasks lazily inside the function body to avoid Django app registry issues. Start the worker separately:

```bash
DJANGO_SETTINGS_MODULE=myproject.settings taskito worker --app myproject.tasks:queue
```

## Can I use taskito with Flask?

Yes. Same pattern — define a queue, decorate tasks, run the worker:

```python
# tasks.py
from taskito import Queue

queue = Queue(db_path="taskito.db")

@queue.task()
def generate_report(report_id: int):
    from myapp import create_app
    app = create_app()
    with app.app_context():
        ...
```

## Can multiple processes share the same SQLite file?

Yes, with caveats. SQLite in WAL mode allows concurrent readers and one writer at a time. taskito sets `busy_timeout=5000ms` to handle contention.

However, taskito is designed as a **single-process** task queue. Multiple worker processes against one database works but will see diminishing returns due to write lock contention. For most workloads, one worker process with multiple threads is sufficient.

## What happens if my worker crashes mid-task?

The job stays in `running` status in SQLite. On the next worker start, the **stale job reaper** detects jobs that have been running longer than their `timeout` and marks them as failed (triggering retries or DLQ).

If no timeout is set, stale jobs remain in `running` status indefinitely. **Always set a timeout on your tasks.**

```python
@queue.task(timeout=300)  # 5 minute timeout
def process(data):
    ...
```

## How big can the SQLite database get?

SQLite can handle databases up to 281 TB (theoretical limit). In practice, taskito databases stay small if you set `result_ttl` to auto-purge old jobs:

```python
queue = Queue(db_path="myapp.db", result_ttl=86400)  # Purge after 24h
```

Without cleanup, expect ~1 KB per job. A million completed jobs ≈ 1 GB.

## Can I use a remote or networked SQLite?

No. SQLite requires local filesystem access for file locking. Network filesystems (NFS, SMB, CIFS) do not reliably support the locking primitives SQLite depends on. Always place the database on local storage.

## When should I use Postgres instead of SQLite?

Use the **Postgres backend** (`pip install taskito[postgres]`) when you need:

- **Multi-machine workers** — run workers on separate servers sharing the same queue
- **Higher write throughput** — Postgres handles concurrent writers better than SQLite
- **Existing Postgres infrastructure** — leverage your existing database and backups

For single-machine workloads, SQLite is simpler and requires zero setup. See the [Postgres Backend guide](guide/postgres.md).

## Is taskito production-ready?

taskito is suitable for production workloads — background job processing, periodic tasks, data pipelines, and similar use cases.

For single-machine deployments, use the default SQLite backend. For multi-server setups, use the [Postgres backend](guide/postgres.md).

## What observability options does taskito support?

taskito offers three observability integrations, each suited to different needs:

| Integration | Best for | Install |
|-------------|----------|---------|
| **[OpenTelemetry](integrations/otel.md)** | Distributed tracing, correlating tasks with HTTP requests | `pip install taskito[otel]` |
| **[Prometheus](integrations/prometheus.md)** | Metrics dashboards, alerting on queue depth/error rates | `pip install taskito[prometheus]` |
| **[Sentry](integrations/sentry.md)** | Error tracking with rich context and breadcrumbs | `pip install taskito[sentry]` |

All three are implemented as `TaskMiddleware` and can be combined together.

## How does taskito compare to running Celery with SQLite?

Celery can use SQLite as a result backend, but still requires a broker (Redis or RabbitMQ). taskito replaces **both** broker and backend with a single SQLite database. Additionally:

- taskito's scheduler runs in Rust (faster polling, lower overhead)
- Worker threads are OS threads managed by Rust, not Python processes
- No external dependencies beyond `cloudpickle`

## Can I use async tasks?

Task functions themselves run synchronously in worker threads. However, you can use async APIs for **enqueuing** and **fetching results**:

```python
job = my_task.delay(data)
result = await job.aresult(timeout=30)
stats = await queue.astats()
```

If your task needs to call async code, use `asyncio.run()` inside the task:

```python
@queue.task()
def fetch_urls(urls: list[str]):
    import asyncio, aiohttp

    async def _fetch():
        async with aiohttp.ClientSession() as session:
            return [await (await session.get(url)).text() for url in urls]

    return asyncio.run(_fetch())
```

## What serialization format does taskito use?

By default, `CloudpickleSerializer` — which supports most Python objects including lambdas and closures. You can switch to `JsonSerializer` for simpler, cross-language payloads, or provide a custom serializer:

```python
from taskito import Queue, JsonSerializer

queue = Queue(serializer=JsonSerializer())
```

Custom serializers implement the `Serializer` protocol with `dumps(obj) -> bytes` and `loads(data) -> Any` methods.

Regardless of serializer, avoid passing unpicklable/unserializable objects like open file handles, database connections, or thread locks.

## Can I run the dashboard and worker in the same process?

They're designed to run as separate processes sharing the same database:

```bash
# Terminal 1
taskito worker --app myapp:queue

# Terminal 2
taskito dashboard --app myapp:queue
```

For embedding in a FastAPI app, use `TaskitoRouter` instead — it provides the same stats and job management as REST endpoints.

## How do I reset / clear all jobs?

```python
# Purge all completed jobs
queue.purge_completed(older_than=0)

# Purge all dead letters
queue.purge_dead(older_than=0)
```

Or delete the database file and restart:

```bash
rm myapp.db myapp.db-wal myapp.db-shm
```
