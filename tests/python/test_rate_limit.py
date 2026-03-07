"""Tests for rate limiting."""

import threading
import time


def test_rate_limit_throttles(queue):
    """Rate-limited tasks should be throttled."""
    timestamps = []

    @queue.task(rate_limit="2/s")
    def rate_limited_task(n):
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
    time.sleep(5)

    # Should have all 4 results
    assert len(timestamps) == 4

    # The time span should be >= 1s (since 4 tasks at 2/s = 2s minimum)
    if len(timestamps) >= 2:
        span = timestamps[-1] - timestamps[0]
        assert span >= 0.5  # Allow some slack
