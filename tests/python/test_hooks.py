"""Tests for the hooks/middleware system."""

from __future__ import annotations

import threading

import pytest

from quickq import Queue


@pytest.fixture
def queue(tmp_path):
    db_path = str(tmp_path / "test_hooks.db")
    return Queue(db_path=db_path, workers=2)


def test_before_and_after_hooks(queue):
    """before_task and after_task hooks fire around task execution."""
    events = []

    @queue.before_task
    def on_before(task_name, args, kwargs):
        events.append(("before", task_name))

    @queue.after_task
    def on_after(task_name, args, kwargs, result, error):
        events.append(("after", task_name, result, error))

    @queue.task()
    def add(a, b):
        return a + b

    job = add.delay(1, 2)

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    result = job.result(timeout=10)
    assert result == 3

    # Verify hooks fired
    assert any(e[0] == "before" for e in events)
    assert any(e[0] == "after" and e[2] == 3 and e[3] is None for e in events)


def test_on_success_hook(queue):
    """on_success hook fires when task succeeds."""
    success_results = []

    @queue.on_success
    def on_success(task_name, args, kwargs, result):
        success_results.append(result)

    @queue.task()
    def multiply(a, b):
        return a * b

    job = multiply.delay(3, 4)

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    result = job.result(timeout=10)
    assert result == 12
    assert 12 in success_results


def test_on_failure_hook(queue):
    """on_failure hook fires when task raises."""
    failure_errors = []

    @queue.on_failure
    def on_failure(task_name, args, kwargs, error):
        failure_errors.append(str(error))

    @queue.task(max_retries=1, retry_backoff=0.1)
    def always_fails():
        raise ValueError("boom")

    always_fails.delay()

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    import time

    time.sleep(3)

    assert any("boom" in e for e in failure_errors)
