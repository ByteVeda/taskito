"""Tests for progress tracking."""

from __future__ import annotations

import time

import pytest

from quickq import Queue


@pytest.fixture
def queue(tmp_path):
    db_path = str(tmp_path / "test_progress.db")
    return Queue(db_path=db_path, workers=2)


def test_update_progress(queue):
    """Progress can be updated and read back."""

    @queue.task()
    def slow_task():

        time.sleep(0.5)
        return "done"

    job = slow_task.delay()

    # Update progress directly via the queue API
    queue.update_progress(job.id, 50)

    refreshed = queue.get_job(job.id)
    assert refreshed.progress == 50

    queue.update_progress(job.id, 100)
    refreshed = queue.get_job(job.id)
    assert refreshed.progress == 100


def test_progress_starts_none(queue):
    """Progress is None by default."""

    @queue.task()
    def task_a():
        return 1

    job = task_a.delay()
    refreshed = queue.get_job(job.id)
    assert refreshed.progress is None
