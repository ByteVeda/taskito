"""Tests for graceful shutdown."""

import threading
import time
from typing import Any

from taskito import Queue

PollUntil = Any  # the conftest fixture's runtime type


def test_graceful_shutdown_completes_inflight(queue: Queue, poll_until: PollUntil) -> None:
    """Graceful shutdown waits for in-flight tasks to complete."""
    completed = threading.Event()

    @queue.task()
    def slow_task() -> str:
        # Intentional pacing — the test asserts the worker waits for this
        # to finish before shutting down.
        time.sleep(1)
        completed.set()
        return "done"

    job = slow_task.delay()

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    # Wait for the task to actually start running before triggering shutdown.
    poll_until(
        lambda: (j := queue.get_job(job.id)) is not None and j.status == "running",
        message="slow_task never reached running state",
    )

    # Request graceful shutdown via the public API
    queue.shutdown()

    # Worker should finish the in-flight task
    worker_thread.join(timeout=10)

    assert completed.is_set()
    fetched = queue.get_job(job.id)
    assert fetched is not None
    assert fetched.status == "complete"


def test_shutdown_stops_worker(queue: Queue) -> None:
    """queue.shutdown() causes run_worker to return."""

    @queue.task()
    def noop() -> None:
        pass

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    # Tiny grace window so the worker reaches its poll loop before shutdown.
    time.sleep(0.1)
    queue.shutdown()

    worker_thread.join(timeout=10)
    assert not worker_thread.is_alive()


def test_shutdown_without_worker_is_noop(queue: Queue) -> None:
    """shutdown() on a queue with no running worker does nothing."""
    queue.shutdown()  # must not raise
