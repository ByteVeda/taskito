"""Tests for queue-wide retention config validation."""

from __future__ import annotations

from pathlib import Path

import pytest

from taskito import Queue


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
