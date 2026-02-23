"""Tests for unique task deduplication."""

from __future__ import annotations

import threading

import pytest

from quickq import Queue


@pytest.fixture
def queue(tmp_path):
    db_path = str(tmp_path / "test_unique.db")
    return Queue(db_path=db_path, workers=2)


def test_unique_key_dedup(queue):
    """Two jobs with the same unique_key should return the same job ID."""

    @queue.task()
    def process(data):
        return data

    job1 = process.apply_async(args=("a",), unique_key="dedup-1")
    job2 = process.apply_async(args=("b",), unique_key="dedup-1")

    assert job1.id == job2.id


def test_different_unique_keys(queue):
    """Different unique keys should create separate jobs."""

    @queue.task()
    def process(data):
        return data

    job1 = process.apply_async(args=("a",), unique_key="key-a")
    job2 = process.apply_async(args=("b",), unique_key="key-b")

    assert job1.id != job2.id


def test_unique_key_allows_after_complete(queue):
    """After a unique job completes, a new one with the same key can be created."""

    @queue.task()
    def fast_task():
        return "done"

    job1 = fast_task.apply_async(unique_key="once")

    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()

    job1.result(timeout=10)

    # Now enqueue again with the same key — should create a new job
    job2 = fast_task.apply_async(unique_key="once")
    assert job2.id != job1.id


def test_no_unique_key_allows_duplicates(queue):
    """Without unique_key, duplicate jobs are allowed."""

    @queue.task()
    def process(data):
        return data

    job1 = process.delay("a")
    job2 = process.delay("a")

    assert job1.id != job2.id
