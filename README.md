# quickq

A Rust-powered task queue for Python. No broker required — just SQLite.

```
pip install quickq
```

## Quickstart

```python
import threading
from quickq import Queue

queue = Queue(db_path="tasks.db")

@queue.task()
def add(a: int, b: int) -> int:
    return a + b

job = add.delay(2, 3)

t = threading.Thread(target=queue.run_worker, daemon=True)
t.start()

print(job.result(timeout=10))  # 5
```

## Why quickq?

Most Python task queues require a separate broker (Redis, RabbitMQ) even for single-machine workloads. quickq embeds everything — storage, scheduling, and worker management — into a single `pip install` with no external dependencies beyond Python itself.

The heavy lifting runs in Rust: a Tokio async scheduler, OS thread worker pool with crossbeam channels, and Diesel ORM over SQLite in WAL mode. Python's GIL is only held during task execution.

## Features

- **Priority queues** — higher priority jobs run first
- **Retry with exponential backoff** — automatic retries with jitter
- **Dead letter queue** — inspect and replay failed jobs
- **Rate limiting** — token bucket with `"100/m"` syntax
- **Task dependencies** — `depends_on` for DAG workflows with cascade cancel
- **Task workflows** — `chain`, `group`, `chord` primitives
- **Periodic tasks** — cron scheduling with seconds granularity
- **Progress tracking** — report and read progress from inside tasks
- **Job cancellation** — cancel pending jobs before execution
- **Unique tasks** — deduplicate active jobs by key
- **Batch enqueue** — `task.map()` for high-throughput bulk inserts
- **Named queues** — route tasks to isolated queues
- **Hooks** — before/after/success/failure middleware
- **Async support** — `await job.aresult()`, `await queue.astats()`
- **Web dashboard** — `quickq dashboard --app myapp:queue` serves a built-in monitoring UI
- **FastAPI integration** — `QuickQRouter` for instant REST API over the queue
- **CLI** — `quickq worker`, `quickq info --watch`, `quickq dashboard`

## Documentation

Full documentation with guides, API reference, architecture diagrams, and examples:

**[Read the docs →](https://pratyush618.github.io/quickq)**

## Comparison

| Feature | quickq | Celery | RQ | Dramatiq | Huey |
|---|---|---|---|---|---|
| Broker required | **No** | Yes | Yes | Yes | Yes |
| Core language | **Rust + Python** | Python | Python | Python | Python |
| Priority queues | **Yes** | Yes | No | No | Yes |
| Rate limiting | **Yes** | Yes | No | Yes | No |
| Dead letter queue | **Yes** | No | Yes | No | No |
| Task dependencies | **Yes** | No | No | No | No |
| Task chaining | **Yes** | Yes | No | Yes | No |
| Built-in dashboard | **Yes** | No | No | No | No |
| FastAPI integration | **Yes** | No | No | No | No |
| Setup | **`pip install`** | Broker + backend | Redis | Broker | Redis |

## License

MIT
