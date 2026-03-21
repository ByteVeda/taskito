"""Tests for graceful shutdown."""

import threading
import time

from taskito import Queue


def test_graceful_shutdown_completes_inflight(queue: Queue) -> None:
    """Graceful shutdown waits for in-flight tasks to complete."""
    completed = threading.Event()

    @queue.task()
    def slow_task() -> str:
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
    assert fetched is not None
    assert fetched.status == "complete"


def test_shutdown_stops_worker(queue: Queue) -> None:
    """request_shutdown causes run_worker to return."""

    @queue.task()
    def noop() -> None:
        pass

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    time.sleep(0.3)
    queue._inner.request_shutdown()

    worker_thread.join(timeout=10)
    assert not worker_thread.is_alive()
