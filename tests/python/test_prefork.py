"""Tests for the prefork (multi-process) worker pool."""

from __future__ import annotations

import contextlib
import importlib
import os
import sys
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from taskito import Queue
from taskito.context import JobContext
from taskito.middleware import TaskMiddleware


def test_prefork_requires_app_path(tmp_path: Path) -> None:
    """pool='prefork' without app= raises ValueError."""
    queue = Queue(db_path=str(tmp_path / "test.db"))

    @queue.task()
    def noop() -> None:
        pass

    with pytest.raises(ValueError, match="app= is required"):
        queue.run_worker(pool="prefork")


def test_prefork_basic_execution(tmp_path: Path) -> None:
    """A task enqueued and processed by a prefork worker returns the correct result.

    NOTE: Prefork children import the app module independently, so the task name
    must resolve to the same module path in both parent and child. Tasks defined
    inside test functions can't be imported by children — use module-level tasks.
    This test is currently skipped; see test_prefork_module_level_queue for the
    working version.
    """
    pytest.skip("Tasks defined inside functions can't be imported by prefork children")


def test_prefork_thread_pool_unchanged(tmp_path: Path) -> None:
    """pool='thread' (default) still works normally."""
    q = Queue(db_path=str(tmp_path / "test.db"))

    @q.task()
    def multiply(x: int, y: int) -> int:
        return x * y

    job = multiply.delay(3, 7)

    worker = threading.Thread(target=q.run_worker, daemon=True)
    worker.start()

    result = job.result(timeout=10)
    assert result == 21

    q._inner.request_shutdown()


# ---------------------------------------------------------------------------
# Per-job timeout enforcement (issue #81)
# ---------------------------------------------------------------------------

# The prefork pool is Unix-oriented: child processes communicate over anonymous
# stdio pipes, which on Windows have different blocking semantics that make
# parent-side reader threads hang after `TerminateProcess`. Per-job timeout
# behaviour itself is identical, but the surrounding pool plumbing isn't
# Windows-ready, so these end-to-end tests are skipped there.
prefork_unix_only = pytest.mark.skipif(
    sys.platform == "win32",
    reason="prefork pool is Unix-only — child stdio pipe semantics differ on Windows",
)

PREFORK_APP_PATH = "prefork_apps.timeout_app:queue"
PREFORK_APP_DIR = str(Path(__file__).parent)


@pytest.fixture
def timeout_app(tmp_path: Path) -> Iterator[object]:
    """Set up the module-level timeout-test app with a per-test DB path.

    The Queue inside ``prefork_apps.timeout_app`` is constructed at import time
    from ``$TASKITO_TIMEOUT_TEST_DB``, and the prefork child re-imports the
    same module fresh in its own interpreter — so the env var must be set in
    the parent process before that import happens, and propagates to the
    child via inherited env.
    """
    db_path = str(tmp_path / "timeout.db")
    prev_db = os.environ.get("TASKITO_TIMEOUT_TEST_DB")
    prev_pythonpath = os.environ.get("PYTHONPATH")

    os.environ["TASKITO_TIMEOUT_TEST_DB"] = db_path
    # Make `prefork_apps.timeout_app` importable in both parent and (inherited)
    # child without depending on pytest's rootdir manipulation.
    os.environ["PYTHONPATH"] = (
        f"{PREFORK_APP_DIR}{os.pathsep}{prev_pythonpath}" if prev_pythonpath else PREFORK_APP_DIR
    )
    if PREFORK_APP_DIR not in sys.path:
        sys.path.insert(0, PREFORK_APP_DIR)

    # Force a fresh module import so the Queue picks up the per-test DB path.
    sys.modules.pop("prefork_apps.timeout_app", None)
    sys.modules.pop("prefork_apps", None)
    module = importlib.import_module("prefork_apps.timeout_app")

    try:
        yield module
    finally:
        with contextlib.suppress(Exception):
            module.queue._inner.request_shutdown()
        if prev_db is None:
            os.environ.pop("TASKITO_TIMEOUT_TEST_DB", None)
        else:
            os.environ["TASKITO_TIMEOUT_TEST_DB"] = prev_db
        if prev_pythonpath is None:
            os.environ.pop("PYTHONPATH", None)
        else:
            os.environ["PYTHONPATH"] = prev_pythonpath


def _start_prefork_worker(queue: Queue) -> threading.Thread:
    """Start a prefork worker for ``queue`` in a daemon thread."""
    thread = threading.Thread(
        target=queue.run_worker,
        kwargs={"pool": "prefork", "app": PREFORK_APP_PATH},
        daemon=True,
    )
    thread.start()
    return thread


def _wait_for_terminal(job: Any, timeout: float) -> str:
    """Poll a JobResult.refresh() until the status is terminal or `timeout` elapses."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job.refresh()
        status: str = job.status
        if status in {"complete", "failed", "dead", "cancelled"}:
            return status
        time.sleep(0.1)
    job.refresh()
    final_status: str = job.status
    return final_status


@prefork_unix_only
def test_prefork_kills_hung_task(timeout_app: object) -> None:
    """A task that hangs past its `timeout=` is SIGKILLed by the watchdog and
    reported as a timeout failure within the timeout + watchdog tick budget."""
    timeouts_seen: list[str] = []

    class TimeoutSpy(TaskMiddleware):
        def on_timeout(self, ctx: JobContext) -> None:
            timeouts_seen.append(ctx.id)

    queue: Queue = timeout_app.queue  # type: ignore[attr-defined]
    queue._global_middleware.append(TimeoutSpy())

    started = time.monotonic()
    job = timeout_app.hang.delay()  # type: ignore[attr-defined]
    _start_prefork_worker(queue)

    # timeout=2s, watchdog tick=250ms → kill within ~2.25s; allow generous
    # headroom for child spawn and CI noise.
    status = _wait_for_terminal(job, timeout=15)
    elapsed = time.monotonic() - started

    assert status == "dead", f"expected 'dead', got {status!r} (error={job.error!r})"
    assert "timed out" in (job.error or "").lower()
    assert elapsed < 12, f"hung task took {elapsed:.1f}s to be killed (expected < 12s)"
    assert job.id in timeouts_seen, "on_timeout middleware did not fire"


@prefork_unix_only
def test_prefork_no_timeout_unaffected(timeout_app: object) -> None:
    """A task with no timeout (timeout=0) runs to completion — the watchdog
    must not kill jobs that have no deadline configured."""
    queue: Queue = timeout_app.queue  # type: ignore[attr-defined]

    job = timeout_app.quick.delay(21)  # type: ignore[attr-defined]
    _start_prefork_worker(queue)

    result = job.result(timeout=15)
    assert result == 42


@prefork_unix_only
def test_prefork_finishes_before_deadline(timeout_app: object) -> None:
    """A task that completes well before its deadline returns normally — the
    watchdog only fires when the deadline is actually crossed."""
    queue: Queue = timeout_app.queue  # type: ignore[attr-defined]

    # timeout=2s, sleep 0.5s — should finish cleanly.
    job = timeout_app.sleep_then_finish.delay(0.5)  # type: ignore[attr-defined]
    _start_prefork_worker(queue)

    result = job.result(timeout=15)
    assert result == "done"
