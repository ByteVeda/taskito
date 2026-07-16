"""The lifecycle must behave identically whether a task is sync or async.

Every test here runs a real ``@queue.task()`` through a real worker, and is
parametrised over ``def`` vs ``async def``. That combination is the point: the
existing async tests drive ``AsyncTaskExecutor`` directly with a mocked queue, so
they cannot see whether a hook fired or a compensation context was set, and the
existing hook/saga/batch tests use a real queue but only sync tasks. Neither
shape catches a gap between the two dispatch paths.

Each test asserts on behaviour a caller was promised, not on which path ran, so
the same assertions hold before and after native async dispatch is activated.
That is also why none of them skip when the build lacks ``native-async``: the
``is_async=True`` cases then route through the blocking path, which is worth
asserting in its own right. Proving *which* path is live is a separate job, and
belongs to the canary that asserts coroutines run on the executor thread —
these tests deliberately cannot tell, and must not.

Tasks are declared before the worker starts on purpose: the scheduler registers
task policy once at worker boot, so a task declared afterwards silently falls
back to ``RetryPolicy::default()`` and ``max_retries=0`` is ignored.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

from taskito import BatchItemResult, MaxRetriesExceededError, Queue
from taskito.context import current_job
from taskito.exceptions import SoftTimeoutError
from taskito.middleware import TaskMiddleware
from taskito.workflows import Workflow, WorkflowState
from taskito.workflows.saga import current_compensation_context

# Parametrise the *task*, not the assertion: `async`ness is a property of the
# function object, so each case defines its own body under an `if is_async`.
BOTH_PATHS = pytest.mark.parametrize("is_async", [False, True], ids=["sync", "async"])

_TIMEOUT = 15.0


@pytest.fixture
def noretry_queue(tmp_path: Path) -> Generator[Queue]:
    """Queue whose jobs DLQ on first failure, so failures stay observable."""
    q = Queue(db_path=str(tmp_path / "parity.db"), workers=2, default_retry=0)
    try:
        yield q
    finally:
        q.close()


def _start_worker(queue: Queue) -> threading.Thread:
    """Start a worker. Call only after every task in the test is declared."""
    thread = threading.Thread(target=queue.run_worker, daemon=True)
    thread.start()
    return thread


def _stop_worker(queue: Queue, thread: threading.Thread) -> None:
    queue._inner.request_shutdown()
    thread.join(timeout=10)


def _wait_for(predicate: Any, message: str) -> None:
    """Poll until ``predicate()`` is truthy, or fail with ``message``."""
    deadline = time.monotonic() + _TIMEOUT
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError(message)


@BOTH_PATHS
def test_queue_hooks_fire(queue: Queue, is_async: bool) -> None:
    """before_task/on_success/after_task fire for either kind of task."""
    events: list[tuple[Any, ...]] = []

    @queue.before_task
    def on_before(task_name: str, args: tuple, kwargs: dict) -> None:
        events.append(("before", task_name))

    @queue.on_success
    def on_ok(task_name: str, args: tuple, kwargs: dict, result: Any) -> None:
        events.append(("success", task_name, result))

    @queue.after_task
    def on_after(task_name: str, args: tuple, kwargs: dict, result: Any, error: Any) -> None:
        events.append(("after", task_name, result, error))

    if is_async:

        @queue.task(name="hooked")
        async def hooked(a: int, b: int) -> int:
            return a + b

    else:

        @queue.task(name="hooked")
        def hooked(a: int, b: int) -> int:
            return a + b

    job = hooked.delay(1, 2)
    thread = _start_worker(queue)
    try:
        assert job.result(timeout=_TIMEOUT) == 3
    finally:
        _stop_worker(queue, thread)

    assert ("before", "hooked") in events
    assert ("success", "hooked", 3) in events
    assert ("after", "hooked", 3, None) in events


@BOTH_PATHS
def test_on_failure_hook_sees_the_exception(noretry_queue: Queue, is_async: bool) -> None:
    """on_failure receives the live exception for either kind of task."""
    failures: list[BaseException] = []

    @noretry_queue.on_failure
    def on_fail(task_name: str, args: tuple, kwargs: dict, error: BaseException) -> None:
        failures.append(error)

    if is_async:

        @noretry_queue.task(name="boom", max_retries=0)
        async def boom() -> None:
            raise ValueError("expected failure")

    else:

        @noretry_queue.task(name="boom", max_retries=0)
        def boom() -> None:
            raise ValueError("expected failure")

    boom.delay()
    thread = _start_worker(noretry_queue)
    try:
        _wait_for(lambda: failures, "on_failure hook never fired")
    finally:
        _stop_worker(noretry_queue, thread)

    assert isinstance(failures[0], ValueError)
    assert "expected failure" in str(failures[0])


@BOTH_PATHS
def test_soft_timeout_makes_check_timeout_raise(noretry_queue: Queue, is_async: bool) -> None:
    """check_timeout() raises once soft_timeout has elapsed, for either kind.

    soft_timeout reaches the task body through per-task config the lifecycle
    reads, so a body that never sees it would return "no timeout" instead.
    """
    outcomes: list[str] = []

    if is_async:

        @noretry_queue.task(name="slow", soft_timeout=0.05, max_retries=0)
        async def slow() -> str:
            time.sleep(0.2)
            try:
                current_job.check_timeout()
            except SoftTimeoutError:
                outcomes.append("raised")
                raise
            outcomes.append("no timeout")
            return "no timeout"

    else:

        @noretry_queue.task(name="slow", soft_timeout=0.05, max_retries=0)
        def slow() -> str:
            time.sleep(0.2)
            try:
                current_job.check_timeout()
            except SoftTimeoutError:
                outcomes.append("raised")
                raise
            outcomes.append("no timeout")
            return "no timeout"

    slow.delay()
    thread = _start_worker(noretry_queue)
    try:
        _wait_for(lambda: outcomes, "task body never ran")
    finally:
        _stop_worker(noretry_queue, thread)

    assert outcomes == ["raised"], "check_timeout() should raise once soft_timeout elapsed"


@BOTH_PATHS
def test_batch_per_item_failure_is_not_a_success(noretry_queue: Queue, is_async: bool) -> None:
    """A per-item failure fails the batch for either kind of task.

    Without per-item handling the task returns a list and looks like a plain
    success, so the failed item's caller would receive that list as its result
    instead of an error.
    """
    batch = {"max_size": 2, "max_wait_ms": 60_000, "per_item_results": True}

    if is_async:

        @noretry_queue.task(name="items", batch=batch, max_retries=0)
        async def items(values: list[int]) -> list[BatchItemResult]:
            return [
                BatchItemResult.failure(item_index=0, error="permanent"),
                BatchItemResult.success(item_index=1, result=values[1]),
            ]

    else:

        @noretry_queue.task(name="items", batch=batch, max_retries=0)
        def items(values: list[int]) -> list[BatchItemResult]:
            return [
                BatchItemResult.failure(item_index=0, error="permanent"),
                BatchItemResult.success(item_index=1, result=values[1]),
            ]

    thread = _start_worker(noretry_queue)
    try:
        first = items.delay(7)
        items.delay(8)
        with pytest.raises(MaxRetriesExceededError, match="permanent"):
            first.result(timeout=_TIMEOUT)
    finally:
        _stop_worker(noretry_queue, thread)


@BOTH_PATHS
def test_saga_compensation_context_is_visible(
    queue: Queue, workflow_worker: Any, is_async: bool
) -> None:
    """A compensator body can read its context for either kind of task.

    Parametrised on the *compensator*, since that is the body that reads the
    context. Its forward step is followed by a failing step to trigger it.
    """
    captured: dict[str, Any] = {}

    if is_async:

        @queue.task(name="refund", max_retries=0)
        async def refund(forward_args: tuple, forward_kwargs: dict, forward_result: Any) -> None:
            ctx = current_compensation_context()
            captured["ctx"] = ctx
            if ctx is not None:
                captured["node_name"] = ctx.workflow_node_name
                captured["forward_result"] = ctx.forward_result

    else:

        @queue.task(name="refund", max_retries=0)
        def refund(forward_args: tuple, forward_kwargs: dict, forward_result: Any) -> None:
            ctx = current_compensation_context()
            captured["ctx"] = ctx
            if ctx is not None:
                captured["node_name"] = ctx.workflow_node_name
                captured["forward_result"] = ctx.forward_result

    @queue.task(name="charge", max_retries=0, compensates=refund)
    def charge(amount: int) -> str:
        return f"charge-{amount}"

    @queue.task(name="fail_later", max_retries=0)
    def fail_later() -> None:
        raise RuntimeError("trigger compensation")

    wf = Workflow(name="parity_saga")
    wf.step("charge", charge, args=(250,))
    wf.step("fail", fail_later, after="charge")

    with workflow_worker():
        run = queue.submit_workflow(wf)
        final = run.wait(timeout=30)
        assert final.state in {WorkflowState.COMPENSATED, WorkflowState.COMPENSATION_FAILED}

    assert captured.get("ctx") is not None, "compensator saw no compensation context"
    assert captured["node_name"] == "charge"
    assert captured["forward_result"] == "charge-250"


@BOTH_PATHS
def test_lifecycle_is_logged(queue: Queue, is_async: bool, caplog: Any) -> None:
    """The received and succeeded lines are emitted for either kind of task."""
    if is_async:

        @queue.task(name="logged")
        async def logged() -> str:
            return "ok"

    else:

        @queue.task(name="logged")
        def logged() -> str:
            return "ok"

    with caplog.at_level("INFO", logger="taskito"):
        job = logged.delay()
        thread = _start_worker(queue)
        try:
            assert job.result(timeout=_TIMEOUT) == "ok"
        finally:
            _stop_worker(queue, thread)

    assert "Task logged" in caplog.text
    assert "received" in caplog.text
    assert "succeeded" in caplog.text


@BOTH_PATHS
def test_middleware_after_receives_the_error(tmp_path: Path, is_async: bool) -> None:
    """Middleware .after() receives the exception, not None, for either kind."""
    seen: list[Any] = []
    ran = threading.Event()

    class Recorder(TaskMiddleware):
        def after(self, job: Any, result: Any, error: Any) -> None:
            seen.append(error)
            ran.set()

    q = Queue(db_path=str(tmp_path / "mw.db"), workers=2, default_retry=0, middleware=[Recorder()])
    try:
        if is_async:

            @q.task(name="failing", max_retries=0)
            async def failing() -> None:
                raise RuntimeError("expected failure")

        else:

            @q.task(name="failing", max_retries=0)
            def failing() -> None:
                raise RuntimeError("expected failure")

        failing.delay()
        thread = _start_worker(q)
        try:
            assert ran.wait(timeout=_TIMEOUT), "middleware after() never fired"
        finally:
            _stop_worker(q, thread)

        assert isinstance(seen[0], RuntimeError), f"after() should see the error, got {seen[0]!r}"
    finally:
        q.close()
