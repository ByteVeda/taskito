"""Tests for native async task support."""

from __future__ import annotations

import asyncio
import threading
import time
from unittest.mock import MagicMock

from taskito import Queue, TaskCancelledError, current_job
from taskito.async_support.context import (
    clear_async_context,
    get_async_context,
    set_async_context,
)
from taskito.middleware import TaskMiddleware

# ── Async detection ──────────────────────────────────────────────


def test_async_task_detected(tmp_path):
    """_taskito_is_async is True for async functions."""
    queue = Queue(db_path=str(tmp_path / "test.db"))

    @queue.task()
    async def my_async_task():
        pass

    assert my_async_task._taskito_is_async is True
    assert hasattr(my_async_task, "_taskito_async_fn")


def test_sync_task_not_async(tmp_path):
    """_taskito_is_async is False for sync functions."""
    queue = Queue(db_path=str(tmp_path / "test.db"))

    @queue.task()
    def my_sync_task():
        pass

    assert my_sync_task._taskito_is_async is False
    assert my_sync_task._taskito_async_fn is None


# ── Async context (contextvars) ──────────────────────────────────


def test_async_context_var():
    """set/get/clear async context via contextvars."""
    token = set_async_context("job-1", "my_task", 0, "default")
    ctx = get_async_context()
    assert ctx is not None
    assert ctx.job_id == "job-1"
    assert ctx.task_name == "my_task"
    assert ctx.retry_count == 0
    assert ctx.queue_name == "default"
    clear_async_context(token)
    assert get_async_context() is None


def test_async_context_isolated_between_tasks():
    """Each async task gets its own contextvar context (no cross-contamination)."""
    results = []

    async def coro(job_id):
        token = set_async_context(job_id, "task", 0, "q")
        await asyncio.sleep(0.01)
        ctx = get_async_context()
        results.append(ctx.job_id if ctx else None)
        clear_async_context(token)

    async def run_both():
        await asyncio.gather(coro("a"), coro("b"))

    asyncio.run(run_both())

    assert sorted(results) == ["a", "b"]


def test_sync_context_unchanged(tmp_path):
    """current_job still works via threading.local for sync tasks."""
    from taskito.context import _clear_context, _set_context

    _set_context("sync-job", "sync_task", 2, "high")
    assert current_job.id == "sync-job"
    assert current_job.task_name == "sync_task"
    assert current_job.retry_count == 2
    assert current_job.queue_name == "high"
    _clear_context()


def test_async_context_fallback_to_sync():
    """_require_context falls back to threading.local when no async context."""
    from taskito.context import _clear_context, _set_context

    # No async context set
    assert get_async_context() is None
    # Set sync context
    _set_context("sync-id", "t", 0, "q")
    assert current_job.id == "sync-id"
    _clear_context()


def test_async_context_preferred_over_sync():
    """When both async and sync contexts exist, async wins."""
    from taskito.context import _clear_context, _set_context

    _set_context("sync-id", "t", 0, "q")
    token = set_async_context("async-id", "t", 0, "q")
    assert current_job.id == "async-id"
    clear_async_context(token)
    assert current_job.id == "sync-id"
    _clear_context()


# ── AsyncTaskExecutor unit tests ─────────────────────────────────


def test_async_executor_lifecycle():
    """Start/stop executor without errors."""
    from taskito.async_support.executor import AsyncTaskExecutor

    sender = MagicMock()
    registry = {}
    queue_ref = MagicMock()
    executor = AsyncTaskExecutor(sender, registry, queue_ref, max_concurrency=10)
    executor.start()
    assert executor._loop is not None
    assert executor._loop.is_running()
    executor.stop()


def test_async_executor_submit_and_execute():
    """Basic async task produces correct result via executor."""
    import cloudpickle

    from taskito.async_support.executor import AsyncTaskExecutor

    sender = MagicMock()

    async def my_task(x, y):
        return x + y

    # Build a minimal wrapper that the executor expects
    class FakeWrapper:
        _taskito_async_fn = staticmethod(my_task)

    registry = {"test_mod.my_task": FakeWrapper()}

    queue_ref = MagicMock()
    queue_ref._interceptor = None
    queue_ref._proxy_registry = None
    queue_ref._test_mode_active = False
    queue_ref._resource_runtime = None
    queue_ref._task_inject_map = {}
    queue_ref._task_retry_filters = {}
    queue_ref._get_middleware_chain.return_value = []
    queue_ref._proxy_metrics = None

    executor = AsyncTaskExecutor(sender, registry, queue_ref, max_concurrency=10)
    executor.start()

    payload = cloudpickle.dumps(((2, 3), {}))
    executor.submit_job("job-1", "test_mod.my_task", payload, 0, 3, "default")
    time.sleep(0.5)
    executor.stop()

    sender.report_success.assert_called_once()
    call_args = sender.report_success.call_args
    assert call_args[0][0] == "job-1"
    assert call_args[0][1] == "test_mod.my_task"
    result = cloudpickle.loads(call_args[0][2])
    assert result == 5


def test_async_exception_reported():
    """Exception in async task → failure result with traceback."""
    import cloudpickle

    from taskito.async_support.executor import AsyncTaskExecutor

    sender = MagicMock()

    async def failing_task():
        raise ValueError("boom")

    class FakeWrapper:
        _taskito_async_fn = staticmethod(failing_task)

    registry = {"mod.failing_task": FakeWrapper()}

    queue_ref = MagicMock()
    queue_ref._interceptor = None
    queue_ref._proxy_registry = None
    queue_ref._test_mode_active = False
    queue_ref._resource_runtime = None
    queue_ref._task_inject_map = {}
    queue_ref._task_retry_filters = {}
    queue_ref._get_middleware_chain.return_value = []
    queue_ref._proxy_metrics = None

    executor = AsyncTaskExecutor(sender, registry, queue_ref, max_concurrency=10)
    executor.start()

    payload = cloudpickle.dumps(((), {}))
    executor.submit_job("job-2", "mod.failing_task", payload, 0, 3, "default")
    time.sleep(0.5)
    executor.stop()

    sender.report_failure.assert_called_once()
    call_args = sender.report_failure.call_args
    assert call_args[0][0] == "job-2"
    assert "boom" in call_args[0][2]
    assert call_args[0][6] is True  # should_retry


def test_async_cancellation():
    """TaskCancelledError → cancelled result."""
    import cloudpickle

    from taskito.async_support.executor import AsyncTaskExecutor

    sender = MagicMock()

    async def cancelling_task():
        raise TaskCancelledError("cancelled")

    class FakeWrapper:
        _taskito_async_fn = staticmethod(cancelling_task)

    registry = {"mod.cancelling_task": FakeWrapper()}

    queue_ref = MagicMock()
    queue_ref._interceptor = None
    queue_ref._proxy_registry = None
    queue_ref._test_mode_active = False
    queue_ref._resource_runtime = None
    queue_ref._task_inject_map = {}
    queue_ref._task_retry_filters = {}
    queue_ref._get_middleware_chain.return_value = []
    queue_ref._proxy_metrics = None

    executor = AsyncTaskExecutor(sender, registry, queue_ref, max_concurrency=10)
    executor.start()

    payload = cloudpickle.dumps(((), {}))
    executor.submit_job("job-3", "mod.cancelling_task", payload, 0, 3, "default")
    time.sleep(0.5)
    executor.stop()

    sender.report_cancelled.assert_called_once()
    assert sender.report_cancelled.call_args[0][0] == "job-3"


def test_async_retry_filter():
    """Failed async task respects retry_on filter."""
    import cloudpickle

    from taskito.async_support.executor import AsyncTaskExecutor

    sender = MagicMock()

    async def flaky_task():
        raise TypeError("wrong type")

    class FakeWrapper:
        _taskito_async_fn = staticmethod(flaky_task)

    registry = {"mod.flaky_task": FakeWrapper()}

    queue_ref = MagicMock()
    queue_ref._interceptor = None
    queue_ref._proxy_registry = None
    queue_ref._test_mode_active = False
    queue_ref._resource_runtime = None
    queue_ref._task_inject_map = {}
    # Only retry on ValueError, not TypeError
    queue_ref._task_retry_filters = {
        "mod.flaky_task": {"retry_on": [ValueError], "dont_retry_on": []},
    }
    queue_ref._get_middleware_chain.return_value = []
    queue_ref._proxy_metrics = None

    executor = AsyncTaskExecutor(sender, registry, queue_ref, max_concurrency=10)
    executor.start()

    payload = cloudpickle.dumps(((), {}))
    executor.submit_job("job-4", "mod.flaky_task", payload, 0, 3, "default")
    time.sleep(0.5)
    executor.stop()

    sender.report_failure.assert_called_once()
    assert sender.report_failure.call_args[0][6] is False  # should_retry = False


def test_async_concurrency_limit():
    """Semaphore bounds concurrent async tasks."""
    import cloudpickle

    from taskito.async_support.executor import AsyncTaskExecutor

    sender = MagicMock()
    max_concurrent = 0
    current = 0
    lock = threading.Lock()

    async def slow_task():
        nonlocal max_concurrent, current
        with lock:
            current += 1
            max_concurrent = max(max_concurrent, current)
        await asyncio.sleep(0.1)
        with lock:
            current -= 1

    class FakeWrapper:
        _taskito_async_fn = staticmethod(slow_task)

    registry = {"mod.slow_task": FakeWrapper()}

    queue_ref = MagicMock()
    queue_ref._interceptor = None
    queue_ref._proxy_registry = None
    queue_ref._test_mode_active = False
    queue_ref._resource_runtime = None
    queue_ref._task_inject_map = {}
    queue_ref._task_retry_filters = {}
    queue_ref._get_middleware_chain.return_value = []
    queue_ref._proxy_metrics = None

    # Set concurrency to 2
    executor = AsyncTaskExecutor(sender, registry, queue_ref, max_concurrency=2)
    executor.start()

    payload = cloudpickle.dumps(((), {}))
    for i in range(5):
        executor.submit_job(f"job-{i}", "mod.slow_task", payload, 0, 3, "default")

    time.sleep(1.0)
    executor.stop()

    assert max_concurrent <= 2
    assert sender.report_success.call_count == 5


def test_async_middleware_hooks():
    """Middleware before/after called for async tasks."""
    import cloudpickle

    from taskito.async_support.executor import AsyncTaskExecutor

    before_called = []
    after_called = []

    class TestMiddleware(TaskMiddleware):
        def before(self, job_context):
            before_called.append(job_context.id)

        def after(self, job_context, result, error):
            after_called.append(job_context.id)

    sender = MagicMock()

    async def simple_task():
        return 42

    class FakeWrapper:
        _taskito_async_fn = staticmethod(simple_task)

    registry = {"mod.simple_task": FakeWrapper()}

    queue_ref = MagicMock()
    queue_ref._interceptor = None
    queue_ref._proxy_registry = None
    queue_ref._test_mode_active = False
    queue_ref._resource_runtime = None
    queue_ref._task_inject_map = {}
    queue_ref._task_retry_filters = {}
    queue_ref._get_middleware_chain.return_value = [TestMiddleware()]
    queue_ref._proxy_metrics = None

    executor = AsyncTaskExecutor(sender, registry, queue_ref, max_concurrency=10)
    executor.start()

    payload = cloudpickle.dumps(((), {}))
    executor.submit_job("mw-job", "mod.simple_task", payload, 0, 3, "default")
    time.sleep(0.5)
    executor.stop()

    assert "mw-job" in before_called
    assert "mw-job" in after_called


def test_async_task_with_injection():
    """inject=["db"] works for async tasks via executor."""
    import cloudpickle

    from taskito.async_support.executor import AsyncTaskExecutor

    sender = MagicMock()

    async def db_task(db=None):
        return f"got-{db}"

    class FakeWrapper:
        _taskito_async_fn = staticmethod(db_task)

    registry = {"mod.db_task": FakeWrapper()}

    fake_db = "fake-conn"

    queue_ref = MagicMock()
    queue_ref._interceptor = None
    queue_ref._proxy_registry = None
    queue_ref._test_mode_active = False
    queue_ref._task_inject_map = {"mod.db_task": ["db"]}
    queue_ref._task_retry_filters = {}
    queue_ref._get_middleware_chain.return_value = []
    queue_ref._proxy_metrics = None

    # Mock resource runtime
    runtime = MagicMock()
    runtime.acquire_for_task.return_value = (fake_db, None)
    queue_ref._resource_runtime = runtime

    executor = AsyncTaskExecutor(sender, registry, queue_ref, max_concurrency=10)
    executor.start()

    payload = cloudpickle.dumps(((), {}))
    executor.submit_job("inj-job", "mod.db_task", payload, 0, 3, "default")
    time.sleep(0.5)
    executor.stop()

    sender.report_success.assert_called_once()
    result = cloudpickle.loads(sender.report_success.call_args[0][2])
    assert result == "got-fake-conn"


def test_async_context_available_inside_task():
    """current_job.id works inside an async task via contextvars."""
    import cloudpickle

    from taskito.async_support.executor import AsyncTaskExecutor

    sender = MagicMock()
    captured_id = []

    async def ctx_task():
        captured_id.append(current_job.id)
        return "ok"

    class FakeWrapper:
        _taskito_async_fn = staticmethod(ctx_task)

    registry = {"mod.ctx_task": FakeWrapper()}

    queue_ref = MagicMock()
    queue_ref._interceptor = None
    queue_ref._proxy_registry = None
    queue_ref._test_mode_active = False
    queue_ref._resource_runtime = None
    queue_ref._task_inject_map = {}
    queue_ref._task_retry_filters = {}
    queue_ref._get_middleware_chain.return_value = []
    queue_ref._proxy_metrics = None

    executor = AsyncTaskExecutor(sender, registry, queue_ref, max_concurrency=10)
    executor.start()

    payload = cloudpickle.dumps(((), {}))
    executor.submit_job("ctx-job", "mod.ctx_task", payload, 0, 3, "default")
    time.sleep(0.5)
    executor.stop()

    assert captured_id == ["ctx-job"]


def test_async_concurrency_parameter(tmp_path):
    """Queue accepts async_concurrency parameter."""
    queue = Queue(db_path=str(tmp_path / "test.db"), async_concurrency=50)
    assert queue._async_concurrency == 50


def test_async_concurrency_default(tmp_path):
    """Default async_concurrency is 100."""
    queue = Queue(db_path=str(tmp_path / "test.db"))
    assert queue._async_concurrency == 100
