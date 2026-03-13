# Testing

taskito includes a built-in test mode that runs tasks **synchronously** in the calling thread — no worker, no Rust scheduler, no SQLite. This makes tests fast, deterministic, and easy to write.

## Quick Example

```python
from taskito import Queue

queue = Queue()

@queue.task()
def add(a: int, b: int) -> int:
    return a + b

def test_add():
    with queue.test_mode() as results:
        add.delay(2, 3)

        assert len(results) == 1
        assert results[0].return_value == 5
        assert results[0].succeeded
```

## How It Works

When you enter `queue.test_mode()`, taskito patches the `enqueue()` method so that every `.delay()` or `.apply_async()` call:

1. Looks up the task function in the registry
2. Calls it immediately in the current thread
3. Captures the return value (or exception) in a `TestResult`
4. Appends the result to the `TestResults` list

No database is created. No worker threads are spawned. Tasks execute eagerly and synchronously.

## `queue.test_mode()`

```python
with queue.test_mode(propagate_errors=False, resources=None) as results:
    # tasks run synchronously here
    ...
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `propagate_errors` | `bool` | `False` | If `True`, task exceptions are re-raised immediately instead of being captured in `TestResult.error` |
| `resources` | `dict[str, Any] \| None` | `None` | Map of resource name → mock instance or `MockResource` for injection. See [Resource System](resources.md#testing-with-resources). |

The context manager yields a `TestResults` list that accumulates results as tasks execute.

## `TestResult`

Each executed task produces a `TestResult`:

```python
with queue.test_mode() as results:
    add.delay(2, 3)

    r = results[0]
    r.job_id        # "test-000001"
    r.task_name     # "mymodule.add"
    r.args          # (2, 3)
    r.kwargs        # {}
    r.return_value  # 5
    r.error         # None
    r.traceback     # None
    r.succeeded     # True
    r.failed        # False
```

| Attribute | Type | Description |
|---|---|---|
| `job_id` | `str` | Synthetic ID like `"test-000001"` |
| `task_name` | `str` | Fully qualified task name |
| `args` | `tuple` | Positional arguments passed to the task |
| `kwargs` | `dict` | Keyword arguments passed to the task |
| `return_value` | `Any` | Return value on success, `None` on failure |
| `error` | `Exception \| None` | The exception if the task failed |
| `traceback` | `str \| None` | Formatted traceback if the task failed |
| `succeeded` | `bool` | `True` if no error |
| `failed` | `bool` | `True` if an error occurred |

## `TestResults`

`TestResults` is a list of `TestResult` with convenience methods:

```python
with queue.test_mode() as results:
    add.delay(2, 3)
    failing_task.delay()
    add.delay(10, 20)

    # Filter by outcome
    results.succeeded   # TestResults with 2 items
    results.failed      # TestResults with 1 item

    # Filter by task name
    results.filter(task_name="mymodule.add")  # 2 items

    # Combine filters
    results.filter(task_name="mymodule.add", succeeded=True)  # 2 items
```

### `.filter()`

```python
results.filter(task_name=None, succeeded=None) -> TestResults
```

| Parameter | Type | Description |
|---|---|---|
| `task_name` | `str \| None` | Filter by exact task name |
| `succeeded` | `bool \| None` | `True` for successes, `False` for failures |

## Testing Failures

By default, task exceptions are captured — not raised:

```python
@queue.task()
def risky():
    raise ValueError("something broke")

def test_failure_captured():
    with queue.test_mode() as results:
        risky.delay()

        assert len(results) == 1
        assert results[0].failed
        assert isinstance(results[0].error, ValueError)
        assert "something broke" in str(results[0].error)
        assert results[0].traceback is not None
```

### Propagating Errors

Use `propagate_errors=True` when you want exceptions to bubble up:

```python
def test_failure_propagated():
    with queue.test_mode(propagate_errors=True) as results:
        with pytest.raises(ValueError, match="something broke"):
            risky.delay()
```

## Testing Workflows

Chains, groups, and chords work in test mode because they call `enqueue()` internally, which is intercepted by the test mode patch.

### Chains

```python
from taskito import chain

@queue.task()
def double(n: int) -> int:
    return n * 2

@queue.task()
def add_ten(n: int) -> int:
    return n + 10

def test_chain():
    with queue.test_mode() as results:
        chain(double.s(5), add_ten.s()).apply()

        assert len(results) == 2
        assert results[0].return_value == 10   # double(5)
        assert results[1].return_value == 20   # add_ten(10)
```

### Groups

```python
from taskito import group

def test_group():
    with queue.test_mode() as results:
        group(double.s(1), double.s(2), double.s(3)).apply()

        assert len(results) == 3
        values = [r.return_value for r in results]
        assert values == [2, 4, 6]
```

## Job Context in Tests

`current_job` works inside test mode. The context is set up before each task runs:

```python
from taskito import current_job

@queue.task()
def context_aware():
    return {
        "job_id": current_job.id,
        "task_name": current_job.task_name,
        "retry_count": current_job.retry_count,
        "queue_name": current_job.queue_name,
    }

def test_context():
    with queue.test_mode() as results:
        context_aware.delay()

        ctx = results[0].return_value
        assert ctx["job_id"].startswith("test-")
        assert ctx["retry_count"] == 0
        assert ctx["queue_name"] == "default"
```

## Pytest Integration

### Fixture Pattern

Create a reusable fixture for test mode:

```python
# conftest.py
import pytest
from myapp import queue

@pytest.fixture
def task_results():
    with queue.test_mode() as results:
        yield results

# test_tasks.py
def test_add(task_results):
    add.delay(2, 3)
    assert task_results[0].return_value == 5

def test_email(task_results):
    send_email.delay("user@example.com", "Hello", "World")
    assert task_results[0].succeeded
```

### Fixture with Error Propagation

```python
@pytest.fixture
def strict_tasks():
    with queue.test_mode(propagate_errors=True) as results:
        yield results
```

### Testing Async Code

Test mode works with async test functions — the tasks still execute synchronously:

```python
import pytest

@pytest.mark.asyncio
async def test_async_enqueue(task_results):
    add.delay(1, 2)
    assert task_results[0].return_value == 3
```

## Testing with Worker Resources

If your tasks use [worker resources](resources.md) (injected via `inject=` or `Inject["name"]`), pass mock instances through `resources=`:

```python
from unittest.mock import MagicMock

@queue.worker_resource("db")
def create_db():
    return real_sessionmaker

@queue.task(inject=["db"])
def create_user(name: str, db):
    session = db()
    session.add(User(name=name))
    session.commit()

def test_create_user():
    mock_db = MagicMock()

    with queue.test_mode(resources={"db": mock_db}) as results:
        create_user.delay("Alice")

    assert results[0].succeeded
    mock_db.return_value.add.assert_called_once()
```

### `MockResource`

`MockResource` adds call tracking to a mock value:

```python
from taskito import MockResource

spy = MockResource("db", wraps=real_db, track_calls=True)

with queue.test_mode(resources={"db": spy}) as results:
    create_user.delay("Alice")

assert spy.call_count == 1
assert results[0].succeeded
```

| Parameter | Type | Description |
|---|---|---|
| `name` | `str` | Resource name (informational). |
| `return_value` | `Any` | Value returned when the resource is accessed. |
| `wraps` | `Any` | Wrap a real object — returned as-is when accessed. |
| `track_calls` | `bool` | Increment `call_count` each access. |

!!! note
    When `resources=` is provided, proxy reconstruction is bypassed automatically. Proxy markers in arguments are passed through as-is so tests don't fail due to missing files or network connections.

## What Test Mode Does NOT Cover

Test mode is designed for **unit and integration testing** of task logic. It does not exercise:

- SQLite storage or queries
- Retry/backoff scheduling
- Rate limiting
- Timeout reaping
- Worker thread pool dispatch
- Priority ordering

For end-to-end tests that exercise the full Rust scheduler, run a real worker in a background thread:

```python
import threading
import time

def test_e2e():
    queue_e2e = Queue(db_path=":memory:")

    @queue_e2e.task()
    def add(a, b):
        return a + b

    t = threading.Thread(target=queue_e2e.run_worker, daemon=True)
    t.start()

    job = add.delay(2, 3)
    result = job.result(timeout=10)
    assert result == 5
```

!!! info "Middleware in test mode"
    Per-task and queue-level `TaskMiddleware` hooks (`before`, `after`, `on_retry`) **do fire** in test mode, since they run in the Python wrapper around your task function. This lets you verify middleware behavior in tests without running a real worker.
