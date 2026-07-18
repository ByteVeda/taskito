"""Tests for queue-wide retention config validation."""

from __future__ import annotations

from pathlib import Path

import pytest

from taskito import Queue, Retention


def test_negative_result_ttl_rejected(tmp_path: Path) -> None:
    # A negative TTL inverts the auto-cleanup cutoff into the future, which
    # matches every archived job — so it must never reach the scheduler.
    with pytest.raises(ValueError, match="result_ttl must be non-negative"):
        Queue(db_path=str(tmp_path / "retention.db"), result_ttl=-1)


def test_overflowing_result_ttl_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="result_ttl too large"):
        Queue(db_path=str(tmp_path / "retention.db"), result_ttl=2**63 // 1000 + 1)


def test_zero_result_ttl_accepted(tmp_path: Path) -> None:
    # Zero is a valid window: purge as soon as a job completes.
    queue = Queue(db_path=str(tmp_path / "retention.db"), result_ttl=0)
    assert queue is not None


def test_retention_map_accepted(tmp_path: Path) -> None:
    queue = Queue(
        db_path=str(tmp_path / "retention.db"),
        retention=Retention(archived_jobs=604_800, dead_letter=2_592_000, task_logs=259_200),
    )
    assert queue is not None


def test_empty_retention_overrides_result_ttl(tmp_path: Path) -> None:
    # An explicit empty Retention disables all windows, winning over result_ttl
    # rather than falling back to it — the precedence contract.
    queue = Queue(
        db_path=str(tmp_path / "retention.db"),
        result_ttl=3600,
        retention=Retention(),
    )
    assert queue is not None


def test_negative_retention_window_rejected_at_construction() -> None:
    # Fail fast on the dataclass, before it ever reaches a Queue.
    with pytest.raises(ValueError, match="retention window 'task_logs' must be non-negative"):
        Retention(task_logs=-1)


def test_retention_map_omits_none_fields() -> None:
    # Only the set windows reach the native layer.
    assert Retention(archived_jobs=7, task_logs=3)._as_map() == {
        "archived_jobs": 7,
        "task_logs": 3,
    }


def test_empty_retention_is_the_opt_out_signal() -> None:
    # Retention is on by default, so opting out is passing an empty Retention():
    # it maps to an empty window set, which the native layer reads as "disable"
    # rather than the omitted case that applies the recommended defaults.
    assert Retention()._as_map() == {}
