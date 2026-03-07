"""Shared fixtures for taskito tests."""

import threading

import pytest

from taskito import Queue


@pytest.fixture
def queue(tmp_path):
    """Create a fresh queue with a temp database."""
    db_path = str(tmp_path / "test.db")
    return Queue(db_path=db_path, workers=2)


@pytest.fixture
def run_worker(queue):
    """Start a worker thread for the given queue. Stops automatically at teardown."""
    thread = threading.Thread(target=queue.run_worker, daemon=True)
    thread.start()
    yield thread
