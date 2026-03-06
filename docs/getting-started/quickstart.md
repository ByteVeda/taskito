# Quickstart

Build your first task queue in 5 minutes.

## 1. Define Tasks

Create a file called `tasks.py`:

```python
from taskito import Queue

# Create a queue backed by SQLite
queue = Queue(db_path="tasks.db")

@queue.task()
def add(a: int, b: int) -> int:
    return a + b

@queue.task(max_retries=3, retry_backoff=2.0)
def send_email(to: str, subject: str, body: str) -> str:
    # Your email sending logic here
    print(f"Sending email to {to}: {subject}")
    return f"sent to {to}"
```

## 2. Enqueue Jobs

```python
from tasks import add, send_email

# Enqueue returns a JobResult handle
job = add.delay(2, 3)
print(f"Job ID: {job.id}")        # Job ID: 01936...
print(f"Status: {job.status}")    # Status: pending
```

## 3. Start a Worker

=== "CLI (Recommended)"

    ```bash
    taskito worker --app tasks:queue
    ```

=== "Threading"

    ```python
    import threading
    from tasks import queue

    t = threading.Thread(target=queue.run_worker, daemon=True)
    t.start()
    ```

=== "Async"

    ```python
    import asyncio
    from tasks import queue

    async def main():
        await queue.arun_worker()

    asyncio.run(main())
    ```

## 4. Get Results

```python
from tasks import add

job = add.delay(2, 3)

# Block until complete (with exponential backoff polling)
result = job.result(timeout=30)
print(result)  # 5

# Or use async
result = await job.aresult(timeout=30)
```

## 5. Monitor

```python
from tasks import queue

stats = queue.stats()
print(stats)
# {'pending': 0, 'running': 0, 'completed': 5, 'failed': 0, 'dead': 0, 'cancelled': 0}
```

Or use the CLI:

```bash
# One-shot stats
taskito info --app tasks:queue

# Live dashboard (refreshes every 2s)
taskito info --app tasks:queue --watch
```

## Next Steps

- [Tasks](../guide/tasks.md) — decorator options, `.delay()` vs `.apply_async()`
- [Workers](../guide/workers.md) — CLI flags, graceful shutdown, worker count
- [Retries](../guide/retries.md) — exponential backoff, dead letter queue
- [Workflows](../guide/workflows.md) — chain, group, chord
- [Testing](../guide/testing.md) — run tasks synchronously in tests with `queue.test_mode()`
- [Migrating from Celery](../guide/migration.md) — concept mapping and side-by-side examples
