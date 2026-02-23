# TaskWrapper

::: quickq.task.TaskWrapper

Created by `@queue.task()` — not instantiated directly. Wraps a decorated function to provide task submission methods.

## Properties

### `task.name`

```python
task.name -> str
```

The registered task name. Either the explicit `name` passed to `@queue.task()` or the function's qualified name.

## Methods

### `task.delay()`

```python
task.delay(*args, **kwargs) -> JobResult
```

Enqueue the task for background execution using the decorator's default options. Returns a [`JobResult`](result.md) handle.

```python
@queue.task(priority=5)
def add(a, b):
    return a + b

job = add.delay(2, 3)
print(job.result(timeout=10))  # 5
```

### `task.apply_async()`

```python
task.apply_async(
    args: tuple = (),
    kwargs: dict | None = None,
    priority: int | None = None,
    delay: float | None = None,
    queue: str | None = None,
    max_retries: int | None = None,
    timeout: int | None = None,
    unique_key: str | None = None,
    metadata: str | None = None,
    depends_on: str | list[str] | None = None,
) -> JobResult
```

Enqueue with full control over submission options. Any parameter not provided falls back to the decorator's default.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `args` | `tuple` | `()` | Positional arguments for the task |
| `kwargs` | `dict \| None` | `None` | Keyword arguments for the task |
| `priority` | `int \| None` | `None` | Override priority (higher = more urgent) |
| `delay` | `float \| None` | `None` | Delay in seconds before the task is eligible |
| `queue` | `str \| None` | `None` | Override queue name |
| `max_retries` | `int \| None` | `None` | Override max retry count |
| `timeout` | `int \| None` | `None` | Override timeout in seconds |
| `unique_key` | `str \| None` | `None` | Deduplicate active jobs with same key |
| `metadata` | `str \| None` | `None` | Arbitrary JSON metadata to attach |
| `depends_on` | `str \| list[str] \| None` | `None` | Job ID(s) this job depends on. See [Dependencies](../guide/dependencies.md). |

```python
job = send_email.apply_async(
    args=("user@example.com", "Hello"),
    priority=10,
    delay=3600,
    queue="emails",
    unique_key="welcome-user@example.com",
    metadata='{"campaign": "onboarding"}',
)
```

### `task.map()`

```python
task.map(iterable: list[tuple]) -> list[JobResult]
```

Enqueue one job per item in a single batch SQLite transaction. Uses the decorator's default options.

```python
jobs = add.map([(1, 2), (3, 4), (5, 6)])
results = [j.result(timeout=10) for j in jobs]
print(results)  # [3, 7, 11]
```

### `task.s()`

```python
task.s(*args, **kwargs) -> Signature
```

Create a **mutable** [`Signature`](canvas.md). In a [`chain`](canvas.md#chain), the previous task's return value is prepended to `args`.

```python
sig = add.s(10)
# In a chain, if the previous step returned 5:
# add(5, 10) → 15
```

### `task.si()`

```python
task.si(*args, **kwargs) -> Signature
```

Create an **immutable** [`Signature`](canvas.md#signature). Ignores the previous task's result — arguments are used as-is.

```python
sig = add.si(2, 3)
# Always calls add(2, 3) regardless of previous result
```

### `task()`

```python
task(*args, **kwargs) -> Any
```

Call the underlying function directly (synchronous, not queued). Useful for testing or when you don't need background execution.

```python
result = add(2, 3)  # Direct call, returns 5
```
