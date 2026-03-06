# Migrating from Celery

This guide maps Celery concepts to their taskito equivalents. If you're coming from Celery, you'll find that most concepts translate directly — with less infrastructure and simpler configuration.

## Concept Mapping

| Celery | taskito | Notes |
|---|---|---|
| `Celery()` app | `Queue()` | No broker URL needed |
| `@app.task` | `@queue.task()` | Same decorator pattern |
| `.apply_async()` | `.apply_async()` | Same name, similar API |
| `.delay()` | `.delay()` | Identical |
| `AsyncResult` | `JobResult` | `.result()` instead of `.get()` |
| Canvas (`chain`, `group`, `chord`) | `chain`, `group`, `chord` | Same names, same concepts |
| `celery beat` | `@queue.periodic()` | Built-in, no separate process |
| Result backend (Redis/DB) | Built-in (SQLite) | No configuration needed |
| Broker (Redis/RabbitMQ) | Not needed | SQLite handles everything |
| `celery worker` | `taskito worker` | Similar CLI |
| `celery inspect` | `taskito info` | Similar CLI |

## Side-by-Side Examples

### App Setup

=== "Celery"

    ```python
    from celery import Celery

    app = Celery(
        "myapp",
        broker="redis://localhost:6379/0",
        backend="redis://localhost:6379/1",
    )
    app.conf.task_serializer = "json"
    app.conf.result_serializer = "json"
    ```

=== "taskito"

    ```python
    from taskito import Queue

    queue = Queue(db_path="myapp.db")
    # That's it. No broker, no backend, no serializer config.
    ```

### Task Definition

=== "Celery"

    ```python
    @app.task(bind=True, max_retries=3)
    def send_email(self, to, subject, body):
        try:
            do_send(to, subject, body)
        except SMTPError as exc:
            raise self.retry(exc=exc, countdown=60)
    ```

=== "taskito"

    ```python
    @queue.task(max_retries=3, retry_backoff=2.0, retry_on=[SMTPError])
    def send_email(to, subject, body):
        do_send(to, subject, body)
        # Retries happen automatically on matching exceptions.
        # Use retry_on/dont_retry_on for selective retries.
    ```

!!! note "Automatic retries"
    In Celery, you must explicitly catch exceptions and call `self.retry()`. In taskito, any unhandled exception triggers a retry automatically (up to `max_retries`).

### Enqueueing Tasks

=== "Celery"

    ```python
    # Simple
    send_email.delay("user@example.com", "Hello", "World")

    # With options
    send_email.apply_async(
        args=("user@example.com", "Hello", "World"),
        countdown=60,       # delay in seconds
        queue="emails",
        priority=5,
    )
    ```

=== "taskito"

    ```python
    # Simple
    send_email.delay("user@example.com", "Hello", "World")

    # With options
    send_email.apply_async(
        args=("user@example.com", "Hello", "World"),
        delay=60,            # delay in seconds
        queue="emails",
        priority=5,
    )
    ```

The only change: `countdown` becomes `delay`.

### Getting Results

=== "Celery"

    ```python
    result = send_email.delay("user@example.com", "Hi", "Body")

    # Block for result
    value = result.get(timeout=30)

    # Check status
    result.status  # "PENDING", "SUCCESS", "FAILURE"
    ```

=== "taskito"

    ```python
    job = send_email.delay("user@example.com", "Hi", "Body")

    # Block for result
    value = job.result(timeout=30)

    # Check status
    job.status  # "pending", "running", "complete", "failed", "dead"
    ```

Key differences:
- `.get()` becomes `.result()`
- Status values are lowercase
- `"SUCCESS"` becomes `"complete"`

### Workflows (Canvas)

=== "Celery"

    ```python
    from celery import chain, group, chord

    # Chain
    chain(fetch.s(url), parse.s(), store.s()).apply_async()

    # Group
    group(process.s(item) for item in items).apply_async()

    # Chord
    chord(
        [download.s(url) for url in urls],
        merge.s()
    ).apply_async()
    ```

=== "taskito"

    ```python
    from taskito import chain, group, chord

    # Chain
    chain(fetch.s(url), parse.s(), store.s()).apply()

    # Group
    group(process.s(item) for item in items).apply()

    # Chord
    chord(
        [download.s(url) for url in urls],
        merge.s()
    ).apply()
    ```

Almost identical. The only change: `.apply_async()` becomes `.apply()`.

### Periodic Tasks

=== "Celery"

    ```python
    # celery.py
    app.conf.beat_schedule = {
        "cleanup-every-hour": {
            "task": "myapp.cleanup",
            "schedule": crontab(minute=0),
        },
    }

    # Requires a separate process:
    # celery -A myapp beat
    ```

=== "taskito"

    ```python
    @queue.periodic(cron="0 0 * * * *")
    def cleanup():
        ...

    # No separate process — the worker handles scheduling.
    # taskito worker --app myapp:queue
    ```

!!! tip
    taskito uses 6-field cron expressions (with seconds). Celery's `crontab()` maps to the last 5 fields, with `0` prepended for seconds.

    | Celery `crontab()` | taskito cron |
    |---|---|
    | `crontab()` (every minute) | `0 * * * * *` |
    | `crontab(minute=0)` (every hour) | `0 0 * * * *` |
    | `crontab(minute=0, hour=0)` (daily) | `0 0 0 * * *` |
    | `crontab(minute=30, hour=9, day_of_week='1-5')` | `0 30 9 * * 1-5` |

### Rate Limiting

=== "Celery"

    ```python
    @app.task(rate_limit="100/m")
    def call_api(endpoint):
        ...
    ```

=== "taskito"

    ```python
    @queue.task(rate_limit="100/m")
    def call_api(endpoint):
        ...
    ```

Identical syntax.

### Worker

=== "Celery"

    ```bash
    celery -A myapp worker --loglevel=info -Q emails,default
    ```

=== "taskito"

    ```bash
    taskito worker --app myapp:queue --queues emails,default
    ```

### Testing

=== "Celery"

    ```python
    # Celery has CELERY_ALWAYS_EAGER mode
    app.conf.task_always_eager = True
    app.conf.task_eager_propagates = True

    result = add.delay(2, 3)
    assert result.get() == 5
    ```

=== "taskito"

    ```python
    with queue.test_mode() as results:
        add.delay(2, 3)
        assert results[0].return_value == 5
    ```

taskito's test mode uses a context manager instead of a global setting, so it's safe to use in parallel test runs.

## What taskito Doesn't Have

Some Celery features don't have taskito equivalents:

| Celery Feature | Status in taskito |
|---|---|
| Distributed workers (multi-server) | Not supported — single-process only |
| Message routing (exchanges, topics) | Use named queues instead |
| `celery multi` (process management) | Use systemd, supervisor, or Docker |
| Custom serializers (JSON, msgpack) | `JsonSerializer`, `CloudpickleSerializer` (default), or custom `Serializer` protocol |
| Task cancellation (mid-execution) | Cancel pending or running jobs (`cancel_running_job()` + `check_cancelled()`) |
| ETA (absolute datetime scheduling) | Use `delay` (relative seconds) |
| `bind=True` (self argument) | Use `current_job` context instead |
| Custom result backends | Built-in SQLite only |

## Migration Checklist

- [ ] Replace `Celery()` with `Queue()`
- [ ] Change `@app.task` to `@queue.task()`
- [ ] Remove `self.retry()` calls — retries are automatic
- [ ] Change `.get()` to `.result()` on job results
- [ ] Change `countdown=` to `delay=` in `.apply_async()`
- [ ] Replace celery beat schedule with `@queue.periodic()`
- [ ] Update cron expressions to 6-field format (prepend seconds)
- [ ] Remove broker and result backend configuration
- [ ] Change `celery worker` to `taskito worker` in deployment scripts
- [ ] Replace `task_always_eager` with `queue.test_mode()` in tests
