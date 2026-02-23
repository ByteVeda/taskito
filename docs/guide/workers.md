# Workers

Workers process queued jobs. quickq runs workers as OS threads within a single process, managed by a Rust scheduler.

## Starting a Worker

=== "CLI (Recommended)"

    ```bash
    quickq worker --app myapp.tasks:queue
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

By default, quickq auto-detects the number of CPU cores:

```python
queue = Queue(db_path="myapp.db", workers=0)  # Auto-detect (default)
queue = Queue(db_path="myapp.db", workers=8)  # Explicit count
```

!!! note
    Workers are **OS threads**, not processes. Each worker acquires the Python GIL only during task execution, so the scheduler and dispatch logic run without GIL contention.

## Graceful Shutdown

quickq supports graceful shutdown via `Ctrl+C`:

1. **First `Ctrl+C`**: Stops accepting new jobs, waits up to 30 seconds for in-flight tasks to complete
2. **Second `Ctrl+C`**: Force-kills immediately

```
$ quickq worker --app myapp:queue
[quickq] Starting worker...
[quickq] Registered tasks: 3
[quickq] Queues: default, emails
^C
[quickq] Shutting down gracefully (waiting for in-flight jobs)...
[quickq] Worker stopped.
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
