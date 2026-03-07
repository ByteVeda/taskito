"""Tests for job cancellation."""

from __future__ import annotations

import threading


def test_cancel_pending_job(queue):
    """A pending job can be cancelled."""

    @queue.task()
    def slow_task():
        return "done"

    job = slow_task.delay()
    assert queue.cancel_job(job.id) is True

    refreshed = queue.get_job(job.id)
    assert refreshed.status == "cancelled"


def test_cancel_nonexistent_job(queue):
    """Cancelling a nonexistent job returns False."""

    @queue.task()
    def dummy():
        pass

    assert queue.cancel_job("nonexistent-id") is False


def test_cancel_completed_job(queue):
    """Cancelling a completed job returns False (only pending can be cancelled)."""

    @queue.task()
    def quick_task():
        return 42

    job = quick_task.delay()

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    job.result(timeout=10)
    assert queue.cancel_job(job.id) is False


def test_cancelled_in_stats(queue):
    """Cancelled jobs show up in stats."""

    @queue.task()
    def task_a():
        pass

    job = task_a.delay()
    queue.cancel_job(job.id)

    stats = queue.stats()
    assert stats["cancelled"] == 1
