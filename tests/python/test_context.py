"""Tests for job context — current_job inside running tasks."""

import threading

import pytest

from quickq import Queue
from quickq.context import current_job


@pytest.fixture
def queue(tmp_path):
    db_path = str(tmp_path / "test_context.db")
    return Queue(db_path=db_path, workers=1)


def test_current_job_raises_outside_task():
    """current_job properties raise RuntimeError outside a task."""
    with pytest.raises(RuntimeError, match="No active job context"):
        _ = current_job.id


def test_current_job_id_available_in_task(queue):
    """current_job.id is accessible inside a running task."""
    captured = {}

    @queue.task()
    def capture_context():
        captured["id"] = current_job.id
        captured["task_name"] = current_job.task_name
        captured["retry_count"] = current_job.retry_count
        captured["queue_name"] = current_job.queue_name
        return "ok"

    job = capture_context.delay()

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    result = job.result(timeout=10)
    assert result == "ok"
    assert captured["id"] == job.id
    assert captured["task_name"].endswith("capture_context")
    assert captured["retry_count"] == 0
    assert captured["queue_name"] == "default"


def test_current_job_update_progress(queue):
    """current_job.update_progress() works inside a running task."""

    @queue.task()
    def task_with_progress():
        current_job.update_progress(50)
        current_job.update_progress(100)
        return "done"

    job = task_with_progress.delay()

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    result = job.result(timeout=10)
    assert result == "done"
