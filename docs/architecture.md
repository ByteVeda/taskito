# Architecture

taskito is a hybrid Python/Rust system. Python provides the user-facing API. Rust handles all the heavy lifting: storage, scheduling, dispatch, rate limiting, and worker management.

## Overview

```mermaid
graph TB
    subgraph Python ["Python Layer"]
        A["Queue"]
        B["@queue.task()"]
        C["TaskWrapper"]
        D["JobResult"]
        E["current_job"]
    end

    subgraph Rust ["Rust Core · PyO3"]
        F["PyQueue"]
        G["Scheduler<br/>Tokio async runtime"]
        H["Worker Pool<br/>OS threads + crossbeam"]
        I["Rate Limiter<br/>Token bucket"]
    end

    subgraph Storage ["Embedded Storage"]
        J[("SQLite · WAL mode<br/>Diesel ORM · r2d2 pool")]
    end

    A -->|"enqueue()"| F
    F -->|INSERT| J
    G -->|"dequeue (poll every 50ms)"| J
    G -->|"dispatch via crossbeam"| H
    H -->|"acquire GIL → run task"| B
    H -->|"JobResult"| G
    G -->|"UPDATE status"| J
    D -->|"poll status"| F
    F -->|SELECT| J
    G -.->|"check rate limit"| I
    I -.->|"token state"| J
```

## Job Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending: enqueue() / delay()
    Pending --> Running: dequeued by scheduler
    Pending --> Cancelled: cancel_job()
    Running --> Complete: task returns successfully
    Running --> Failed: task raises exception
    Failed --> Pending: retry (count < max_retries)\nwith exponential backoff
    Failed --> Dead: retries exhausted\nmoved to DLQ
    Dead --> Pending: retry_dead()
    Complete --> [*]
    Cancelled --> [*]
    Dead --> [*]: purge_dead()
```

**Status codes in SQLite:**

| Status | Integer | Description |
|---|---|---|
| Pending | 0 | Waiting to be picked up |
| Running | 1 | Currently executing |
| Complete | 2 | Finished successfully |
| Failed | 3 | Last attempt failed (may retry) |
| Dead | 4 | All retries exhausted, in DLQ |
| Cancelled | 5 | Cancelled before execution |

## Worker Pool

```mermaid
graph LR
    subgraph Scheduler ["Scheduler Thread"]
        S["Tokio async runtime<br/>50ms poll interval"]
    end

    S -->|"Job"| JCH["Job Channel<br/>(bounded: workers×2)"]

    subgraph Pool ["Worker Threads"]
        W1["Worker 1<br/>GIL per task"]
        W2["Worker 2<br/>GIL per task"]
        WN["Worker N<br/>GIL per task"]
    end

    JCH --> W1
    JCH --> W2
    JCH --> WN

    W1 -->|"Result"| RCH["Result Channel<br/>(bounded: workers×2)"]
    W2 -->|"Result"| RCH
    WN -->|"Result"| RCH

    RCH --> ML["Main Loop<br/>(py.allow_threads)"]
    ML -->|"complete / retry / DLQ"| DB[("SQLite")]
```

**Key design decisions:**

- **OS threads, not Python threads**: Workers are Rust `std::thread` threads. The GIL is only acquired when calling Python task code.
- **Bounded channels**: Both job and result channels are bounded to `workers × 2` to provide backpressure.
- **GIL isolation**: Each worker acquires the GIL independently using `Python::with_gil()`. The scheduler and result handler release the GIL via `py.allow_threads()`.

## Storage Layer

### SQLite Configuration

| Pragma | Value | Why |
|---|---|---|
| `journal_mode` | WAL | Concurrent reads while writing |
| `busy_timeout` | 5000ms | Wait on lock contention instead of failing |
| `synchronous` | NORMAL | Fast writes, safe with WAL |
| `journal_size_limit` | 64MB | Prevent unbounded WAL file growth |

### Database Schema

**6 tables:**

```sql
-- Core job storage
jobs (id, queue, task_name, payload, status, priority,
      created_at, scheduled_at, started_at, completed_at,
      retry_count, max_retries, result, error, timeout_ms,
      unique_key, progress, metadata,
      cancel_requested, expires_at, result_ttl_ms)

-- Dead letter queue
dead_letter (id, original_job_id, queue, task_name,
             payload, error, retry_count, failed_at, metadata)

-- Token bucket rate limiting
rate_limits (key, tokens, max_tokens, refill_rate, last_refill)

-- Cron-scheduled tasks
periodic_tasks (name, task_name, cron_expr, args, kwargs,
                queue, enabled, last_run, next_run)

-- Per-attempt error tracking
job_errors (id, job_id, attempt, error, failed_at)

-- Worker heartbeat tracking
workers (worker_id, last_heartbeat, queues, status)
```

**Key indexes:**

- `idx_jobs_dequeue`: `(queue, status, priority DESC, scheduled_at)` — fast dequeue
- `idx_jobs_status`: `(status)` — fast stats queries
- `idx_jobs_unique_key`: partial unique index on `unique_key` where status is pending/running
- `idx_job_errors_job_id`: `(job_id)` — fast error history lookup

### Connection Pooling

Diesel's `r2d2` connection pool with up to 8 connections. In-memory databases use a single connection (SQLite `:memory:` is per-connection).

## Scheduler Loop

The scheduler runs in a dedicated Tokio single-threaded async runtime:

```
loop {
    sleep(50ms) or shutdown signal

    // Try to dequeue and dispatch a job
    try_dispatch()

    // Every ~100 iterations (~5s): reap timed-out jobs
    reap_stale()

    // Every ~60 iterations (~3s): check periodic tasks
    check_periodic()

    // Every ~1200 iterations (~60s): auto-cleanup old jobs
    auto_cleanup()
}
```

### Dispatch Flow

1. `dequeue_from()` — atomically SELECT + UPDATE (pending → running) within a transaction
2. Check rate limit — if over limit, reschedule 1s in the future
3. Send job to worker pool via crossbeam channel
4. Worker executes task, sends result back
5. `handle_result()` — mark complete, schedule retry, or move to DLQ

## Serialization

taskito uses a pluggable serializer for task arguments and results. The default is `CloudpickleSerializer`, which supports lambdas, closures, and complex Python objects.

```python
from taskito import Queue, JsonSerializer

# Use JSON for simpler, cross-language payloads
queue = Queue(serializer=JsonSerializer())
```

**Built-in serializers:**

| Serializer | Format | Best for |
|---|---|---|
| `CloudpickleSerializer` (default) | Binary (pickle) | Complex Python objects, lambdas, closures |
| `JsonSerializer` | JSON | Simple types, cross-language interop, debugging |

**Custom serializers** implement the `Serializer` protocol (`dumps(obj) -> bytes`, `loads(data) -> Any`).

- **Arguments**: `serializer.dumps((args, kwargs))` — stored as BLOB in `payload`
- **Results**: `serializer.dumps(return_value)` — stored as BLOB in `result`
- **Periodic task args**: Serialized at registration time, stored as BLOBs in `periodic_tasks.args`

