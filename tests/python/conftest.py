"""Shared fixtures for taskito tests."""

import threading
from collections.abc import Generator
from pathlib import Path

import pytest

from taskito import Queue


@pytest.fixture
def queue(tmp_path: Path) -> Queue:
    """Create a fresh queue with a temp database."""
    db_path = str(tmp_path / "test.db")
    return Queue(db_path=db_path, workers=2)


@pytest.fixture
def run_worker(queue: Queue) -> Generator[threading.Thread]:
    """Start a worker thread for the given queue. Stops automatically at teardown."""
    thread = threading.Thread(target=queue.run_worker, daemon=True)
    thread.start()
    yield thread
    queue._inner.request_shutdown()
    thread.join(timeout=5)
