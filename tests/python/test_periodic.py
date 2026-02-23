"""Tests for periodic (cron-scheduled) tasks."""

import threading
import time

import pytest

from quickq import Queue


@pytest.fixture
def queue(tmp_path):
    db_path = str(tmp_path / "test_periodic.db")
    return Queue(db_path=db_path, workers=1)


def test_periodic_task_registration(queue):
    """Periodic tasks are registered as both regular tasks and periodic configs."""

    @queue.periodic(cron="0 * * * * *")
    def every_minute():
        return "tick"

    assert every_minute.name.endswith("every_minute")
    assert every_minute.name in queue._task_registry
    assert len(queue._periodic_configs) == 1
    assert queue._periodic_configs[0]["cron_expr"] == "0 * * * * *"


def test_periodic_task_direct_call(queue):
    """Periodic tasks can still be called directly like regular tasks."""

    @queue.periodic(cron="0 * * * * *")
    def add(a, b):
        return a + b

    assert add(3, 4) == 7


def test_periodic_task_triggers(queue):
    """Periodic task gets enqueued by the scheduler when due."""
    results = []

    @queue.periodic(cron="* * * * * *")  # every second
    def frequent_task():
        results.append(1)
        return "done"

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    # Wait for the periodic task to trigger at least once
    deadline = time.time() + 15
    while time.time() < deadline:
        stats = queue.stats()
        if stats["completed"] >= 1:
            break
        time.sleep(0.5)

    assert queue.stats()["completed"] >= 1
