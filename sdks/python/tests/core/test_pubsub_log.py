"""Log topics (S28): one stored message per publish, pulled via a cursor."""

import threading
from typing import Any

from taskito import Queue, TopicMessage

PollUntil = Any  # the conftest fixture's runtime type


class TestLogPublish:
    def test_publish_stores_one_message_per_call(self, queue: Queue) -> None:
        queue.subscribe_log("events", "analytics")

        # No fan-out jobs; one stored message per publish regardless of readers.
        assert queue.publish("events", 1, kind="a") == []
        assert queue.publish("events", 2, kind="b") == []

        msgs = queue.read_topic("events", "analytics")
        assert [(m.args, m.kwargs) for m in msgs] == [((1,), {"kind": "a"}), ((2,), {"kind": "b"})]
        assert all(isinstance(m, TopicMessage) for m in msgs)

    def test_read_is_empty_before_any_publish(self, queue: Queue) -> None:
        queue.subscribe_log("events", "analytics")
        assert queue.read_topic("events", "analytics") == []

    def test_late_subscriber_misses_earlier_publishes(self, queue: Queue) -> None:
        # A log subscription only sees messages published after it registered.
        queue.publish("events", "early")  # no subscriber yet → nothing stored
        queue.subscribe_log("events", "late")
        queue.publish("events", "seen")
        msgs = queue.read_topic("events", "late")
        assert [m.args for m in msgs] == [("seen",)]


class TestCursor:
    def test_ack_advances_and_is_monotonic(self, queue: Queue) -> None:
        queue.subscribe_log("events", "c")
        for i in range(3):
            queue.publish("events", i)

        msgs = queue.read_topic("events", "c")
        assert [m.args[0] for m in msgs] == [0, 1, 2]

        # Ack through the middle message: the next read starts after it.
        assert queue.ack_topic("events", "c", msgs[1].id) is True
        remaining = queue.read_topic("events", "c")
        assert [m.args[0] for m in remaining] == [2]

        # Acking an older cursor never rewinds.
        assert queue.ack_topic("events", "c", msgs[0].id) is False
        assert [m.args[0] for m in queue.read_topic("events", "c")] == [2]

    def test_unacked_read_is_at_least_once(self, queue: Queue) -> None:
        queue.subscribe_log("events", "c")
        queue.publish("events", "x")
        # Reading without acking (e.g. a crash mid-process) re-delivers.
        assert [m.args for m in queue.read_topic("events", "c")] == [("x",)]
        assert [m.args for m in queue.read_topic("events", "c")] == [("x",)]

    def test_limit_bounds_the_page(self, queue: Queue) -> None:
        queue.subscribe_log("events", "c")
        for i in range(5):
            queue.publish("events", i)
        first = queue.read_topic("events", "c", limit=2)
        assert [m.args[0] for m in first] == [0, 1]
        queue.ack_topic("events", "c", first[-1].id)
        assert [m.args[0] for m in queue.read_topic("events", "c", limit=2)] == [2, 3]


class TestMixedTopic:
    def test_log_and_fanout_subscribers_coexist(
        self, queue: Queue, run_worker: threading.Thread, poll_until: PollUntil
    ) -> None:
        seen: list[int] = []
        lock = threading.Lock()

        @queue.subscriber("events", name="worker")
        def handle(n: int) -> None:
            with lock:
                seen.append(n)

        queue.declare_subscriptions()
        queue.subscribe_log("events", "log")

        # One publish: the fan-out subscriber runs its job...
        queue.publish("events", 7)
        poll_until(lambda: seen == [7], timeout=30, message="fan-out subscriber should run")

        # ...and the same publish stored one log message for the log subscriber.
        assert [m.args for m in queue.read_topic("events", "log")] == [(7,)]


class TestManagedConsumer:
    """A ``log_consumer`` daemon thread pulls, invokes the handler, and acks."""

    @staticmethod
    def _worker(queue: Queue) -> threading.Thread:
        thread = threading.Thread(target=queue.run_worker, daemon=True)
        thread.start()
        return thread

    def test_consumer_invokes_handler_and_advances_cursor(
        self, queue: Queue, poll_until: PollUntil
    ) -> None:
        received: list[int] = []
        lock = threading.Lock()

        @queue.log_consumer("events", "c", poll_interval=0.05)
        def handle(n: int) -> None:
            with lock:
                received.append(n)

        thread = self._worker(queue)
        try:
            for i in range(3):
                queue.publish("events", i)
            poll_until(lambda: sorted(received) == [0, 1, 2], timeout=30, message="handler ran")
        finally:
            queue.shutdown()
            thread.join(timeout=5)

        # Every message handled → cursor caught up, nothing left to read.
        (stat,) = queue.topic_log_stats()
        assert stat["lag"] == 0

    def test_async_handler_is_awaited(self, queue: Queue, poll_until: PollUntil) -> None:
        received: list[int] = []
        lock = threading.Lock()

        @queue.log_consumer("events", "c", poll_interval=0.05)
        async def handle(n: int) -> None:
            with lock:
                received.append(n)

        thread = self._worker(queue)
        try:
            queue.publish("events", 42)
            poll_until(lambda: received == [42], timeout=30, message="async handler awaited")
        finally:
            queue.shutdown()
            thread.join(timeout=5)

    def test_on_error_retry_redelivers_failed_message(
        self, queue: Queue, poll_until: PollUntil
    ) -> None:
        # Value 1 fails on its first attempt, then succeeds; value 0 (acked
        # before the failure) is never redelivered.
        attempts: list[int] = []
        failed_once = threading.Event()
        lock = threading.Lock()

        @queue.log_consumer("events", "c", poll_interval=0.05, on_error="retry")
        def handle(n: int) -> None:
            with lock:
                attempts.append(n)
            if n == 1 and not failed_once.is_set():
                failed_once.set()
                raise RuntimeError("boom")

        thread = self._worker(queue)
        try:
            for i in range(3):
                queue.publish("events", i)
            poll_until(
                lambda: attempts.count(1) == 2 and 2 in attempts,
                timeout=30,
                message="failed message re-read, then batch completes",
            )
        finally:
            queue.shutdown()
            thread.join(timeout=5)

        assert attempts.count(0) == 1  # acked before the failure, never redelivered

    def test_on_error_skip_advances_past_poison(self, queue: Queue, poll_until: PollUntil) -> None:
        attempts: list[int] = []
        lock = threading.Lock()

        @queue.log_consumer("events", "c", poll_interval=0.05, on_error="skip")
        def handle(n: int) -> None:
            with lock:
                attempts.append(n)
            if n == 1:
                raise RuntimeError("always poison")

        thread = self._worker(queue)
        try:
            for i in range(3):
                queue.publish("events", i)
            poll_until(
                lambda: sorted(attempts) == [0, 1, 2], timeout=30, message="skip past poison"
            )
        finally:
            queue.shutdown()
            thread.join(timeout=5)

        # Poison attempted once then acked past → cursor caught up, no re-read.
        (stat,) = queue.topic_log_stats()
        assert stat["lag"] == 0
        assert attempts.count(1) == 1

    def test_shutdown_stops_consumer_thread(self, queue: Queue, poll_until: PollUntil) -> None:
        handled: list[int] = []

        @queue.log_consumer("events", "c", poll_interval=0.05)
        def handle(n: int) -> None:
            handled.append(n)

        thread = self._worker(queue)
        queue.publish("events", 1)
        # Wait until the consumer has actually run before shutting down, so the
        # request can't race an unstarted worker (which would block forever).
        poll_until(
            lambda: handled == [1], timeout=30, message="consumer should run before shutdown"
        )
        queue.shutdown()
        thread.join(timeout=5)
        assert not thread.is_alive()


class TestLogStats:
    def test_lag_reflects_unacked(self, queue: Queue) -> None:
        queue.subscribe_log("events", "c")
        for i in range(3):
            queue.publish("events", i)

        (stat,) = queue.topic_log_stats()
        assert stat["topic"] == "events"
        assert stat["subscription"] == "c"
        assert stat["cursor"] is None
        assert stat["lag"] == 3

        msgs = queue.read_topic("events", "c")
        queue.ack_topic("events", "c", msgs[-1].id)
        (stat,) = queue.topic_log_stats()
        assert stat["lag"] == 0
        assert stat["oldest_unacked_age_ms"] is None
