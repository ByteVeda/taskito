# Workers

Workers process queued jobs. taskito runs workers as OS threads within a single process, managed by a Rust scheduler.

## Starting a Worker

=== "CLI (Recommended)"

    ```bash
    taskito worker --app myapp.tasks:queue
    ```

    | Flag | Description |
    |---|---|
    | `--app` | Python path to your Queue instance (`module:attribute`) |
    | `--queues` | Comma-separated queue names (default: all registered) |

=== "Programmatic"

    ```python
    # Blocks the current thread
    queue.run_worker()

    # With specific queues
    queue.run_worker(queues=["emails", "reports"])
    ```

=== "Background Thread"

    ```python
    import threading

    t = threading.Thread(target=queue.run_worker, daemon=True)
    t.start()

    # Your application continues...
    ```

=== "Async"

    ```python
    import asyncio

    async def main():
        # Runs worker in a thread pool, non-blocking
        await queue.arun_worker()

    asyncio.run(main())
    ```

## Worker Count

By default, taskito auto-detects the number of CPU cores:

```python
queue = Queue(db_path="myapp.db", workers=0)  # Auto-detect (default)
queue = Queue(db_path="myapp.db", workers=8)  # Explicit count
```

## Worker Specialization

Tag workers to route jobs to specific machines or capabilities:

```python
# Start a worker that only processes jobs tagged for GPU or heavy workloads
queue.run_worker(tags=["gpu", "heavy"])
```

Jobs submitted to a queue with `tags` are only picked up by workers that have all the required tags. Workers without tags process untagged jobs.

```bash
# CLI equivalent
taskito worker --app myapp:queue --tags gpu,heavy
```

!!! note
    Workers are **OS threads**, not processes. Each worker acquires the Python GIL only during task execution, so the scheduler and dispatch logic run without GIL contention.

## Graceful Shutdown

taskito supports graceful shutdown via `Ctrl+C`:

1. **First `Ctrl+C`**: Stops accepting new jobs, waits for in-flight tasks to complete (up to `drain_timeout` seconds)
2. **Second `Ctrl+C`**: Force-kills immediately

Configure the drain timeout when constructing the queue:

```python
queue = Queue(db_path="myapp.db", drain_timeout=60)  # wait up to 60 seconds
```

The default `drain_timeout` is 30 seconds.

```
$ taskito worker --app myapp:queue
[taskito] Starting worker...
[taskito] Registered tasks: 3
[taskito] Queues: default, emails
^C
[taskito] Shutting down gracefully (waiting for in-flight jobs)...
[taskito] Worker stopped.
```

### Programmatic Shutdown

```python
# From another thread or signal handler
queue._inner.request_shutdown()
```

## How Workers Work

```mermaid
graph LR
    S["Scheduler<br/>(Tokio async)"] -->|Job| CH["Bounded Channel"]

    CH --> W1["Worker 1"]
    CH --> W2["Worker 2"]
    CH --> WN["Worker N"]

    W1 -->|Result| RCH["Result Channel"]
    W2 -->|Result| RCH
    WN -->|Result| RCH

    RCH --> ML["Result Handler"]
    ML -->|"complete / retry / DLQ"| DB[("SQLite")]
```

1. The **scheduler** runs in a dedicated Tokio async thread, polling SQLite for ready jobs every 50ms
2. Ready jobs are sent to the **worker pool** via a bounded crossbeam channel
3. Each **worker thread** acquires the GIL, deserializes arguments, and runs the Python function
4. Results flow back through a **result channel** to the main loop
5. The main loop updates job status in SQLite (complete, retry, or DLQ)
