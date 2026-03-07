"""Tests for batch enqueue (enqueue_many / task.map)."""

import threading


def test_enqueue_many(queue):
    """enqueue_many enqueues all items in a single batch."""

    @queue.task()
    def double(x):
        return x * 2

    jobs = queue.enqueue_many(
        task_name=double.name,
        args_list=[(i,) for i in range(10)],
    )
    assert len(jobs) == 10

    stats = queue.stats()
    assert stats["pending"] == 10


def test_task_map(queue):
    """TaskWrapper.map() enqueues and returns results."""

    @queue.task()
    def add(a, b):
        return a + b

    jobs = add.map([(1, 2), (3, 4), (5, 6)])
    assert len(jobs) == 3

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    results = [j.result(timeout=10) for j in jobs]
    assert sorted(results) == [3, 7, 11]


def test_batch_stats(queue):
    """Batch enqueue of 50 items shows correct pending count."""

    @queue.task()
    def noop():
        pass

    queue.enqueue_many(
        task_name=noop.name,
        args_list=[() for _ in range(50)],
    )

    stats = queue.stats()
    assert stats["pending"] == 50
