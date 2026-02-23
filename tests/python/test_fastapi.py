"""Tests for FastAPI integration."""

import threading

import pytest

from taskito import Queue

# Skip entire module if fastapi is not installed
fastapi = pytest.importorskip("fastapi")
httpx = pytest.importorskip("httpx")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from taskito.contrib.fastapi import TaskitoRouter


@pytest.fixture
def queue(tmp_path):
    """Create a fresh queue."""
    db_path = str(tmp_path / "test_fastapi.db")
    return Queue(db_path=db_path, workers=2)


@pytest.fixture
def app(queue):
    """Create a FastAPI app with TaskitoRouter."""
    app = FastAPI()
    app.include_router(TaskitoRouter(queue), prefix="/tasks")
    return app


@pytest.fixture
def client(app):
    """Create a TestClient."""
    return TestClient(app)


@pytest.fixture
def populated(queue, client):
    """Queue with a task and some jobs."""

    @queue.task()
    def add(a, b):
        return a + b

    jobs = [add.delay(i, i + 1) for i in range(5)]
    return queue, client, jobs, add


# ── Stats ────────────────────────────────────────────────


def test_stats(populated):
    queue, client, jobs, add = populated
    resp = client.get("/tasks/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["pending"] == 5
    assert data["running"] == 0


# ── Job detail ───────────────────────────────────────────


def test_get_job(populated):
    queue, client, jobs, add = populated
    job_id = jobs[0].id
    resp = client.get(f"/tasks/jobs/{job_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == job_id
    assert data["status"] == "pending"


def test_get_job_not_found(client):
    resp = client.get("/tasks/jobs/nonexistent")
    assert resp.status_code == 404


# ── Job errors ───────────────────────────────────────────


def test_get_job_errors_empty(populated):
    queue, client, jobs, add = populated
    job_id = jobs[0].id
    resp = client.get(f"/tasks/jobs/{job_id}/errors")
    assert resp.status_code == 200
    assert resp.json() == []


# ── Job result ───────────────────────────────────────────


def test_get_job_result_pending(populated):
    queue, client, jobs, add = populated
    job_id = jobs[0].id
    resp = client.get(f"/tasks/jobs/{job_id}/result")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert data["result"] is None


def test_get_job_result_completed(populated):
    queue, client, jobs, add = populated

    worker = threading.Thread(target=queue.run_worker, daemon=True)
    worker.start()

    # Wait for first job to complete
    jobs[0].result(timeout=10)

    resp = client.get(f"/tasks/jobs/{jobs[0].id}/result")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "complete"
    assert data["result"] == 1  # add(0, 1) = 1


# ── Cancel ───────────────────────────────────────────────


def test_cancel_job(populated):
    queue, client, jobs, add = populated
    job_id = jobs[0].id
    resp = client.post(f"/tasks/jobs/{job_id}/cancel")
    assert resp.status_code == 200
    assert resp.json()["cancelled"] is True

    # Cancel again — should be false
    resp = client.post(f"/tasks/jobs/{job_id}/cancel")
    assert resp.json()["cancelled"] is False


# ── Dead letters ─────────────────────────────────────────


def test_dead_letters_empty(client):
    resp = client.get("/tasks/dead-letters")
    assert resp.status_code == 200
    assert resp.json() == []


# ── Progress SSE ─────────────────────────────────────────


def test_progress_stream(populated):
    queue, client, jobs, add = populated

    # Start worker so the job completes
    worker = threading.Thread(target=queue.run_worker, daemon=True)
    worker.start()

    job_id = jobs[0].id
    # Wait for job to finish first
    jobs[0].result(timeout=10)

    with client.stream("GET", f"/tasks/jobs/{job_id}/progress") as resp:
        assert resp.status_code == 200
        lines = []
        for line in resp.iter_lines():
            if line.startswith("data:"):
                lines.append(line)
                break  # Just check first event

    assert len(lines) >= 1
    # The first (and only) event should show complete status
    import json
    data = json.loads(lines[0].replace("data: ", ""))
    assert data["status"] == "complete"


def test_progress_stream_not_found(client):
    resp = client.get("/tasks/jobs/nonexistent/progress")
    assert resp.status_code == 404


# ── Router config ────────────────────────────────────────


def test_router_custom_tags(queue):
    """TaskitoRouter accepts standard APIRouter kwargs."""
    router = TaskitoRouter(queue, tags=["my-tasks"])
    assert "my-tasks" in router.tags


def test_router_custom_prefix(queue):
    """Router can be mounted with a custom prefix."""
    app = FastAPI()
    app.include_router(TaskitoRouter(queue), prefix="/api/v1/queue")
    client = TestClient(app)

    resp = client.get("/api/v1/queue/stats")
    assert resp.status_code == 200
