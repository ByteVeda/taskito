# taskito

A Rust-powered task queue for Python. No broker required — just SQLite.

```
pip install taskito
```

## Quickstart

```python
import threading
from taskito import Queue

queue = Queue(db_path="tasks.db")

@queue.task()
def add(a: int, b: int) -> int:
    return a + b

job = add.delay(2, 3)

t = threading.Thread(target=queue.run_worker, daemon=True)
t.start()

print(job.result(timeout=10))  # 5
```

## Why taskito?

Most Python task queues require a separate broker (Redis, RabbitMQ) even for single-machine workloads. taskito embeds everything — storage, scheduling, and worker management — into a single `pip install` with no external dependencies beyond Python itself.

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
- **Web dashboard** — `taskito dashboard --app myapp:queue` serves a built-in monitoring UI
- **FastAPI integration** — `TaskitoRouter` for instant REST API over the queue
- **CLI** — `taskito worker`, `taskito info --watch`, `taskito dashboard`

## Examples

### Retry with Backoff

```python
@queue.task(max_retries=5, retry_backoff=2.0)
def fetch_url(url: str) -> str:
    return requests.get(url).text
```

### Priority Queues

```python
urgent_report.apply_async(args=[data], priority=10)
bulk_report.delay(data)  # default priority 0
```

### Rate Limiting

```python
@queue.task(rate_limit="100/m")
def call_api(endpoint: str) -> dict:
    return requests.get(endpoint).json()
```

### Task Dependencies

```python
download = fetch_file.delay("data.csv")
parsed = parse_file.apply_async(
    args=["data.csv"],
    depends_on=[download.id],
)
# parsed waits until download completes; if download fails, parsed is cancelled
```

### Workflows

```python
from taskito import chain, group, chord

# Sequential pipeline — each step receives the previous result
chain(fetch.s(url), parse.s(), store.s()).apply()

# Parallel fan-out
group(process.s(chunk) for chunk in chunks).apply()

# Parallel + callback when all complete
chord([download.s(u) for u in urls], merge.s()).apply()
```

### Periodic Tasks

```python
@queue.periodic(cron="0 */6 * * *")
def cleanup_temp_files():
    ...
```

### Progress Tracking

```python
from taskito import current_job

@queue.task()
def train_model(epochs: int):
    for i in range(epochs):
        ...
        current_job.update_progress(int((i + 1) / epochs * 100))
```

### Hooks

```python
@queue.on_failure
def alert_on_failure(task_name, args, kwargs, error):
    slack.post(f"Task {task_name} failed: {error}")
```

### Delayed Scheduling

```python
# Run 30 minutes from now
reminder.apply_async(args=[user_id, msg], delay=1800)
```

### Unique Tasks

```python
report.apply_async(args=[user_id], unique_key=f"report:{user_id}")
# Second enqueue with same key is silently deduplicated while first is active
```

### FastAPI Integration

```python
from fastapi import FastAPI
from taskito.contrib.fastapi import TaskitoRouter

app = FastAPI()
app.include_router(TaskitoRouter(queue), prefix="/tasks")
# GET /tasks/stats, GET /tasks/jobs/{id}, GET /tasks/jobs/{id}/progress (SSE), ...
```

### Batch Enqueue

```python
jobs = send_email.map([("alice@x.com",), ("bob@x.com",), ("carol@x.com",)])
```

### Async Support

```python
job = expensive_task.delay(data)
result = await job.aresult(timeout=30)
stats = await queue.astats()
```

## Documentation

Full documentation with guides, API reference, architecture diagrams, and examples:

**[Read the docs →](https://taskito-sepia.vercel.app)**

## Comparison

| Feature | taskito | Celery | RQ | Dramatiq | Huey |
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
