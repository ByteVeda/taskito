"""Basic tests for quickq — enqueue, dequeue, result retrieval."""

import threading

import pytest

from quickq import Queue


@pytest.fixture
def queue(tmp_path):
    """Create a fresh queue with a temp database."""
    db_path = str(tmp_path / "test.db")
    return Queue(db_path=db_path, workers=2)


def test_task_registration(queue):
    """Tasks can be registered with the decorator."""

    @queue.task()
    def add(a, b):
        return a + b

    assert add.name.endswith("add")
    assert add.name in queue._task_registry


def test_enqueue_returns_job_result(queue):
    """Enqueueing a task returns a JobResult handle."""

    @queue.task()
    def noop():
        pass

    job = noop.delay()
    assert job.id is not None
    assert len(job.id) > 0


def test_task_direct_call(queue):
    """Decorated tasks can still be called directly."""

    @queue.task()
    def multiply(a, b):
        return a * b

    assert multiply(3, 4) == 12


def test_apply_async_with_delay(queue):
    """apply_async accepts a delay parameter."""

    @queue.task()
    def slow_task():
        pass

    job = slow_task.apply_async(delay=60)
    assert job.id is not None


def test_apply_async_with_overrides(queue):
    """apply_async can override default task settings."""

    @queue.task(priority=1, queue="default")
    def configurable_task(x):
        return x

    job = configurable_task.apply_async(
        args=(42,),
        priority=10,
        queue="urgent",
        max_retries=5,
        timeout=600,
    )
    assert job.id is not None


def test_queue_stats(queue):
    """stats() returns counts by status."""

    @queue.task()
    def sample_task():
        pass

    sample_task.delay()
    sample_task.delay()

    stats = queue.stats()
    assert stats["pending"] == 2
    assert stats["running"] == 0


def test_worker_executes_task(queue):
    """Worker processes tasks and stores results."""

    @queue.task()
    def add(a, b):
        return a + b

    job = add.delay(2, 3)

    # Run worker in a background thread
    worker_thread = threading.Thread(
        target=queue.run_worker,
        daemon=True,
    )
    worker_thread.start()

    # Wait for result
    result = job.result(timeout=10)
    assert result == 5


def test_worker_handles_kwargs(queue):
    """Worker correctly passes keyword arguments."""

    @queue.task()
    def greet(name, greeting="Hello"):
        return f"{greeting}, {name}!"

    job = greet.delay("World", greeting="Hi")

    worker_thread = threading.Thread(
        target=queue.run_worker,
        daemon=True,
    )
    worker_thread.start()

    result = job.result(timeout=10)
    assert result == "Hi, World!"


def test_worker_none_result(queue):
    """Tasks returning None work correctly."""

    @queue.task()
    def void_task():
        pass

    job = void_task.delay()

    worker_thread = threading.Thread(
        target=queue.run_worker,
        daemon=True,
    )
    worker_thread.start()

    result = job.result(timeout=10)
    assert result is None
