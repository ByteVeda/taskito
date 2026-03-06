# Testing API Reference

::: taskito.testing

## `TestMode`

```python
from taskito.testing import TestMode
# or use the shortcut:
# queue.test_mode()
```

Context manager that intercepts `enqueue()` to run tasks synchronously. No worker, no Rust, no SQLite.

### Constructor

```python
TestMode(queue: Queue, propagate_errors: bool = False)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `queue` | `Queue` | *required* | The Queue instance to put into test mode |
| `propagate_errors` | `bool` | `False` | Re-raise task exceptions immediately instead of capturing them |

### Usage

```python
with TestMode(queue) as results:
    my_task.delay(42)
    assert results[0].return_value == expected

# Shortcut via Queue:
with queue.test_mode() as results:
    my_task.delay(42)
```

---

## `TestResult`

```python
from taskito import TestResult
```

Dataclass capturing the result of a single task execution in test mode.

### Attributes

| Attribute | Type | Description |
|---|---|---|
| `job_id` | `str` | Synthetic test ID (e.g. `"test-000001"`) |
| `task_name` | `str` | Fully qualified name of the task |
| `args` | `tuple` | Positional arguments the task was called with |
| `kwargs` | `dict` | Keyword arguments the task was called with |
| `return_value` | `Any` | Return value of the task (or `None` if it failed) |
| `error` | `Exception \| None` | Exception instance if the task raised |
| `traceback` | `str \| None` | Formatted traceback string if the task raised |

### Properties

| Property | Type | Description |
|---|---|---|
| `succeeded` | `bool` | `True` if `error is None` |
| `failed` | `bool` | `True` if `error is not None` |

---

## `TestResults`

```python
from taskito import TestResults
```

A `list[TestResult]` subclass with convenience filtering methods.

### Properties

| Property | Returns | Description |
|---|---|---|
| `succeeded` | `TestResults` | All results where `succeeded is True` |
| `failed` | `TestResults` | All results where `failed is True` |

### Methods

#### `.filter()`

```python
results.filter(task_name: str | None = None, succeeded: bool | None = None) -> TestResults
```

Filter results by task name and/or outcome.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `task_name` | `str \| None` | `None` | Exact match on task name |
| `succeeded` | `bool \| None` | `None` | `True` = successes only, `False` = failures only |

Returns a new `TestResults` containing only matching items.

**Examples:**

```python
results.filter(task_name="myapp.send_email")
results.filter(succeeded=False)
results.filter(task_name="myapp.process", succeeded=True)
```
