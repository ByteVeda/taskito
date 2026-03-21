"""Tests for dashboard API endpoints and list_jobs/to_dict."""

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

from taskito import Queue


@pytest.fixture
def queue(tmp_path: Path) -> Queue:
    """Create a fresh queue with some test data pre-registered."""
    db_path = str(tmp_path / "test_dashboard.db")
    q = Queue(db_path=db_path, workers=2)

    @q.task(queue="default")
    def task_a(x: int) -> int:
        return x * 2

    @q.task(queue="email")
    def task_b(x: int) -> int:
        return x + 1

    return q


@pytest.fixture
def populated_queue(queue: Queue) -> tuple[Queue, list[Any]]:
    """Queue with several jobs enqueued."""
    task_a_name: str = ""
    task_b_name: str = ""
    for name, _fn in queue._task_registry.items():
        if "task_a" in name:
            task_a_name = name
        elif "task_b" in name:
            task_b_name = name

    jobs: list[Any] = []
    for i in range(5):
        jobs.append(queue.enqueue(task_a_name, args=(i,)))
    for i in range(3):
        jobs.append(queue.enqueue(task_b_name, args=(i,), queue="email"))
    return queue, jobs


# ── list_jobs tests ──────────────────────────────────────


def test_list_jobs_returns_all(populated_queue: tuple[Queue, list[Any]]) -> None:
    """list_jobs() with no filters returns all jobs."""
    queue, _ = populated_queue
    result = queue.list_jobs()
    assert len(result) == 8


def test_list_jobs_filter_by_queue(populated_queue: tuple[Queue, list[Any]]) -> None:
    """list_jobs() can filter by queue name."""
    queue, _ = populated_queue
    result = queue.list_jobs(queue="email")
    assert len(result) == 3
    for j in result:
        d = j.to_dict()
        assert d["queue"] == "email"


def test_list_jobs_filter_by_status(populated_queue: tuple[Queue, list[Any]]) -> None:
    """list_jobs() can filter by status."""
    queue, _ = populated_queue
    result = queue.list_jobs(status="pending")
    assert len(result) == 8  # all are pending

    result = queue.list_jobs(status="running")
    assert len(result) == 0


def test_list_jobs_filter_by_task_name(populated_queue: tuple[Queue, list[Any]]) -> None:
    """list_jobs() can filter by task name."""
    queue, _ = populated_queue
    # Find the task_a name
    task_a_name = None
    for name in queue._task_registry:
        if "task_a" in name:
            task_a_name = name
            break

    result = queue.list_jobs(task_name=task_a_name)
    assert len(result) == 5


def test_list_jobs_pagination(populated_queue: tuple[Queue, list[Any]]) -> None:
    """list_jobs() respects limit and offset."""
    queue, _ = populated_queue
    page1 = queue.list_jobs(limit=3, offset=0)
    page2 = queue.list_jobs(limit=3, offset=3)

    assert len(page1) == 3
    assert len(page2) == 3

    ids1 = {j.id for j in page1}
    ids2 = {j.id for j in page2}
    assert ids1.isdisjoint(ids2)


def test_list_jobs_invalid_status(queue: Queue) -> None:
    """list_jobs() raises on invalid status string."""
    with pytest.raises(ValueError):
        queue.list_jobs(status="bogus")


# ── to_dict tests ────────────────────────────────────────


def test_to_dict_fields(queue: Queue) -> None:
    """to_dict() returns all expected fields."""

    @queue.task()
    def dummy() -> None:
        pass

    job = dummy.delay()
    d = job.to_dict()

    expected_keys = {
        "id",
        "queue",
        "task_name",
        "status",
        "priority",
        "progress",
        "retry_count",
        "max_retries",
        "created_at",
        "scheduled_at",
        "started_at",
        "completed_at",
        "error",
        "timeout_ms",
        "unique_key",
        "metadata",
    }
    assert set(d.keys()) == expected_keys
    assert d["status"] == "pending"
    assert d["id"] == job.id


def test_to_dict_is_json_serializable(queue: Queue) -> None:
    """to_dict() output can be serialized to JSON."""

    @queue.task()
    def dummy() -> None:
        pass

    job = dummy.delay()
    d = job.to_dict()
    serialized = json.dumps(d)
    assert isinstance(serialized, str)


# ── Dashboard HTTP tests ─────────────────────────────────


@pytest.fixture
def dashboard_server(
    populated_queue: tuple[Queue, list[Any]],
) -> Generator[tuple[str, Queue, list[Any]]]:
    """Start a dashboard server on a random port."""
    queue, jobs = populated_queue
    from http.server import ThreadingHTTPServer

    from taskito.dashboard import _make_handler

    handler = _make_handler(queue)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    yield f"http://127.0.0.1:{port}", queue, jobs

    server.shutdown()


def _get(url: str) -> Any:
    """GET request and parse JSON."""
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read())


def _post(url: str) -> Any:
    """POST request and parse JSON."""
    req = urllib.request.Request(url, method="POST", data=b"")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def test_api_stats(dashboard_server: tuple[str, Queue, list[Any]]) -> None:
    """GET /api/stats returns valid stats dict."""
    base, _, __ = dashboard_server
    data = _get(f"{base}/api/stats")
    assert "pending" in data
    assert data["pending"] == 8


def test_api_jobs_list(dashboard_server: tuple[str, Queue, list[Any]]) -> None:
    """GET /api/jobs returns job list."""
    base, _, __ = dashboard_server
    data = _get(f"{base}/api/jobs")
    assert isinstance(data, list)
    assert len(data) == 8


def test_api_jobs_filter_status(dashboard_server: tuple[str, Queue, list[Any]]) -> None:
    """GET /api/jobs?status=pending filters correctly."""
    base, _, __ = dashboard_server
    data = _get(f"{base}/api/jobs?status=pending")
    assert len(data) == 8

    data = _get(f"{base}/api/jobs?status=running")
    assert len(data) == 0


def test_api_jobs_filter_queue(dashboard_server: tuple[str, Queue, list[Any]]) -> None:
    """GET /api/jobs?queue=email filters correctly."""
    base, _, __ = dashboard_server
    data = _get(f"{base}/api/jobs?queue=email")
    assert len(data) == 3


def test_api_jobs_pagination(dashboard_server: tuple[str, Queue, list[Any]]) -> None:
    """GET /api/jobs?limit=3&offset=0 paginates."""
    base, _, __ = dashboard_server
    data = _get(f"{base}/api/jobs?limit=3&offset=0")
    assert len(data) == 3


def test_api_job_detail(dashboard_server: tuple[str, Queue, list[Any]]) -> None:
    """GET /api/jobs/{id} returns job dict."""
    base, _, jobs = dashboard_server
    job_id = jobs[0].id
    data = _get(f"{base}/api/jobs/{job_id}")
    assert data["id"] == job_id
    assert "status" in data


def test_api_job_not_found(dashboard_server: tuple[str, Queue, list[Any]]) -> None:
    """GET /api/jobs/nonexistent returns 404."""
    base, _, __ = dashboard_server
    try:
        _get(f"{base}/api/jobs/nonexistent-id")
        raise AssertionError("Expected 404")
    except urllib.error.HTTPError as e:
        assert e.code == 404


def test_api_cancel_job(dashboard_server: tuple[str, Queue, list[Any]]) -> None:
    """POST /api/jobs/{id}/cancel cancels a pending job."""
    base, _, jobs = dashboard_server
    job_id = jobs[0].id
    data = _post(f"{base}/api/jobs/{job_id}/cancel")
    assert data["cancelled"] is True


def test_api_dead_letters_empty(dashboard_server: tuple[str, Queue, list[Any]]) -> None:
    """GET /api/dead-letters returns empty list initially."""
    base, _, __ = dashboard_server
    data = _get(f"{base}/api/dead-letters")
    assert data == []


def test_spa_html_served(dashboard_server: tuple[str, Queue, list[Any]]) -> None:
    """GET / returns the SPA HTML."""
    base, _, __ = dashboard_server
    with urllib.request.urlopen(base) as resp:
        html = resp.read().decode()
        assert "taskito dashboard" in html
        assert "<!DOCTYPE html>" in html
