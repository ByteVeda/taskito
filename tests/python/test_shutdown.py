"""Tests for graceful shutdown."""

import threading
import time

import pytest

from quickq import Queue


@pytest.fixture
def queue(tmp_path):
    db_path = str(tmp_path / "test_shutdown.db")
    return Queue(db_path=db_path, workers=2)


def test_graceful_shutdown_completes_inflight(queue):
    """Graceful shutdown waits for in-flight tasks to complete."""
    completed = threading.Event()

    @queue.task()
    def slow_task():
        time.sleep(1)
        completed.set()
        return "done"

    job = slow_task.delay()

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    # Wait a bit for the task to start
    time.sleep(0.3)

    # Request graceful shutdown
    queue._inner.request_shutdown()

    # Worker should finish the in-flight task
    worker_thread.join(timeout=10)

    assert completed.is_set()
    fetched = queue.get_job(job.id)
    assert fetched.status == "complete"


def test_shutdown_stops_worker(queue):
    """request_shutdown causes run_worker to return."""

    @queue.task()
    def noop():
        pass

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    time.sleep(0.3)
    queue._inner.request_shutdown()

    worker_thread.join(timeout=10)
    assert not worker_thread.is_alive()
