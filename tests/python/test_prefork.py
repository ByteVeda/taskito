"""Tests for the prefork (multi-process) worker pool."""

from __future__ import annotations

import threading
from pathlib import Path

import pytest

from taskito import Queue


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
