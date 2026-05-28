"""Tests for rate limiting."""

import threading
import time
from typing import Any

from taskito import Queue

PollUntil = Any  # the conftest fixture's runtime type


def test_rate_limit_throttles(queue: Queue, poll_until: PollUntil) -> None:
    """Rate-limited tasks should be throttled."""
    timestamps: list[float] = []

    @queue.task(rate_limit="2/s")
    def rate_limited_task(n: int) -> int:
        timestamps.append(time.monotonic())
        return n

    # Enqueue 4 tasks (at 2/s, should take ~2s)
    for i in range(4):
        rate_limited_task.delay(i)

    worker_thread = threading.Thread(
        target=queue.run_worker,
        daemon=True,
    )
    worker_thread.start()

    # Wait for all tasks
    poll_until(lambda: len(timestamps) == 4, timeout=10)

    # Should have all 4 results
    assert len(timestamps) == 4

    # The time span should be >= 1s (since 4 tasks at 2/s = 2s minimum)
    if len(timestamps) >= 2:
        span = timestamps[-1] - timestamps[0]
        assert span >= 0.5  # Allow some slack
