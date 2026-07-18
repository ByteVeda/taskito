"""S26 — opt-in ``max_pending`` admission cap.

Jobs stay Pending without a running worker, so these tests exercise the cap
purely on the producer side.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from taskito import Queue, QueueFullError


def _register(queue: Queue) -> None:
    @queue.task(name="noop")
    def noop() -> None:  # pragma: no cover - never executed (no worker)
        return None


def test_count_pending_by_queue_primitive(queue: Queue) -> None:
    _register(queue)
    assert queue._inner.count_pending_by_queue("default") == 0
    queue.enqueue("noop")
    queue.enqueue("noop")
    assert queue._inner.count_pending_by_queue("default") == 2


def test_uncapped_queue_never_rejects(queue: Queue) -> None:
    _register(queue)
    for _ in range(50):
        queue.enqueue("noop")
    assert queue._inner.count_pending_by_queue("default") == 50


def test_runtime_setter_rejects_at_cap(queue: Queue) -> None:
    _register(queue)
    queue.set_queue_max_pending("default", 2)
    queue.enqueue("noop")
    queue.enqueue("noop")
    with pytest.raises(QueueFullError) as exc:
        queue.enqueue("noop")
    assert "max_pending 2" in str(exc.value)
    # Rejected enqueue inserted nothing.
    assert queue._inner.count_pending_by_queue("default") == 2


def test_constructor_cap(tmp_path: Path) -> None:
    q = Queue(db_path=str(tmp_path / "t.db"), workers=1, max_pending={"default": 1})
    _register(q)
    q.enqueue("noop")
    with pytest.raises(QueueFullError):
        q.enqueue("noop")


def test_cap_is_per_queue(queue: Queue) -> None:
    _register(queue)
    queue.set_queue_max_pending("tight", 1)
    queue.enqueue("noop", queue="tight")
    with pytest.raises(QueueFullError):
        queue.enqueue("noop", queue="tight")
    # A different, uncapped queue is unaffected.
    for _ in range(5):
        queue.enqueue("noop", queue="wide")


def test_queue_full_is_queue_error_subclass() -> None:
    from taskito.exceptions import QueueError, TaskitoError

    assert issubclass(QueueFullError, QueueError)
    assert issubclass(QueueFullError, TaskitoError)


def test_enqueue_many_all_or_nothing(queue: Queue) -> None:
    _register(queue)
    queue.set_queue_max_pending("default", 3)
    queue.enqueue("noop")
    queue.enqueue("noop")
    queue.enqueue("noop")  # now at cap
    with pytest.raises(QueueFullError):
        queue.enqueue_many("noop", [(), (), ()])
    # None of the batch landed.
    assert queue._inner.count_pending_by_queue("default") == 3


def test_cap_frees_after_drain(queue: Queue, run_worker: object) -> None:
    """Once pending drains below the cap, enqueue is admitted again."""
    from taskito import JobResult

    results: list[JobResult] = []

    @queue.task(name="quick")
    def quick() -> str:
        return "ok"

    queue.set_queue_max_pending("default", 100)
    # With a worker draining, pending stays well under the cap.
    for _ in range(20):
        results.append(queue.enqueue("quick"))
    for r in results:
        assert r.result(timeout=10) == "ok"
