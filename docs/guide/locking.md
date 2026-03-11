# Distributed Locking

taskito provides a distributed lock primitive backed by the same database used for the task queue. Locks work across multiple worker processes and machines sharing the same database.

## Overview

Use distributed locks when multiple workers or processes must not execute the same critical section at the same time — for example, refreshing a shared cache, running a singleton periodic task, or accessing an external API with a single-writer constraint.

## Sync Context Manager

```python
with queue.lock("cache-refresh"):
    refresh_cache()
```

The lock is automatically released when the `with` block exits, even if an exception is raised.

### Parameters

```python
queue.lock(
    name: str,
    ttl: int = 30,
    auto_extend: bool = True,
    owner_id: str | None = None,
    timeout: float | None = None,
    retry_interval: float = 0.1,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | `str` | — | Lock name. All processes using the same name compete for the same lock. |
| `ttl` | `int` | `30` | Lock TTL in seconds. Auto-extended if `auto_extend=True`. |
| `auto_extend` | `bool` | `True` | Automatically extend the lock before it expires (background thread). |
| `owner_id` | `str \| None` | `None` | Custom owner identifier. Defaults to a random UUID per acquisition. |
| `timeout` | `float \| None` | `None` | Max seconds to wait for the lock. `None` raises immediately if unavailable. |
| `retry_interval` | `float` | `0.1` | Seconds between retry attempts when waiting for the lock. |

## Async Context Manager

```python
async with queue.alock("cache-refresh"):
    await refresh_cache()
```

`alock()` accepts the same parameters as `lock()` and is safe to use inside async functions and FastAPI/Django async views.

## Auto-Extension

When `auto_extend=True` (the default), a background thread extends the lock's TTL at roughly half the TTL interval. This prevents the lock from expiring during a long-running operation without requiring you to set an artificially large TTL.

```python
# This lock will stay alive for as long as the block runs,
# even if it takes several minutes.
with queue.lock("long-job", ttl=30, auto_extend=True):
    run_slow_operation()
```

## Acquisition Timeout

By default, `lock()` raises `LockNotAcquired` immediately if the lock is held by another process. Pass `timeout` to wait:

```python
try:
    with queue.lock("resource", timeout=5.0):
        do_work()
except LockNotAcquired:
    print("Could not acquire lock within 5 seconds")
```

The lock is retried every `retry_interval` seconds until `timeout` is exceeded.

## Cross-Process Locking

Because lock state is stored in the database, locks are effective across multiple worker processes on the same machine or different machines sharing the same database:

```python
# Process A (machine 1)
with queue.lock("billing-run"):
    run_billing()

# Process B (machine 2) — will wait or raise while process A holds the lock
with queue.lock("billing-run"):
    run_billing()
```

!!! note "SQLite vs Postgres"
    On SQLite, cross-process locking works via WAL mode and exclusive transactions. For multi-machine deployments, use the PostgreSQL backend where `SELECT FOR UPDATE SKIP LOCKED` provides true distributed semantics.

## Error Handling

```python
from taskito import LockNotAcquired

try:
    with queue.lock("my-lock", timeout=2.0):
        critical_section()
except LockNotAcquired:
    # Another process holds the lock; handle gracefully
    log.warning("Skipping — another process is running the critical section")
```

## Low-Level API

For advanced use cases, you can manage locks manually without the context manager:

```python
# Acquire
lock_id = queue._inner.acquire_lock("my-lock", ttl=30)

# Extend
queue._inner.extend_lock("my-lock", lock_id, ttl=30)

# Inspect
info = queue._inner.get_lock_info("my-lock")
# {"name": "my-lock", "owner_id": "...", "expires_at": 1710000000}

# Release
queue._inner.release_lock("my-lock", lock_id)
```

!!! warning
    The low-level API skips auto-extension and does not release on exception. Prefer the context manager (`lock()` / `alock()`) for production code.
