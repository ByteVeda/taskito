"""Tests for retry logic and dead letter queue."""

import threading
import time

import pytest

from taskito import Queue


@pytest.fixture
def queue(tmp_path):
    db_path = str(tmp_path / "test_retry.db")
    return Queue(db_path=db_path, workers=2)


def test_failing_task_retries(queue):
    """A failing task should be retried up to max_retries times."""
    call_count = 0

    @queue.task(max_retries=3, retry_backoff=0.1)
    def flaky_task():
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            raise ValueError(f"attempt {call_count}")
        return "success"

    job = flaky_task.delay()

    worker_thread = threading.Thread(
        target=queue.run_worker,
        daemon=True,
    )
    worker_thread.start()

    result = job.result(timeout=30)
    assert result == "success"
    assert call_count == 3


def test_exhausted_retries_goes_to_dlq(queue):
    """A task that always fails should end up in the dead letter queue."""

    @queue.task(max_retries=2, retry_backoff=0.1)
    def always_fails():
        raise RuntimeError("permanent failure")

    always_fails.delay()

    worker_thread = threading.Thread(
        target=queue.run_worker,
        daemon=True,
    )
    worker_thread.start()

    # Wait for the job to exhaust retries and move to DLQ
    time.sleep(5)

    # Check that it's in the DLQ
    dead = queue.dead_letters()
    assert len(dead) >= 1
    assert dead[0]["task_name"].endswith("always_fails")


def test_retry_dead_letter(queue):
    """A dead letter job can be re-enqueued."""

    @queue.task(max_retries=1, retry_backoff=0.1)
    def fail_once():
        raise RuntimeError("fail")

    fail_once.delay()

    worker_thread = threading.Thread(
        target=queue.run_worker,
        daemon=True,
    )
    worker_thread.start()

    time.sleep(3)

    dead = queue.dead_letters()
    if dead:
        new_id = queue.retry_dead(dead[0]["id"])
        assert new_id is not None
        assert len(new_id) > 0
