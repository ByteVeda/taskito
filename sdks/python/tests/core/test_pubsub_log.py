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
        poll_until(lambda: seen == [7], message="fan-out subscriber should run")

        # ...and the same publish stored one log message for the log subscriber.
        assert [m.args for m in queue.read_topic("events", "log")] == [(7,)]


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


class TestTopicRegistry:
    def test_declared_topic_retains_without_subscribers(self, queue: Queue) -> None:
        queue.declare_topic("events")
        # No subscriber yet, but declared → the publish is retained.
        assert queue.publish("events", 1) == []
        assert queue.publish("events", 2) == []
        # A log subscriber that joins later still sees the earlier publishes.
        queue.subscribe_log("events", "late")
        assert [m.args for m in queue.read_topic("events", "late")] == [(1,), (2,)]

    def test_undeclared_topic_keeps_late_join_boundary(self, queue: Queue) -> None:
        queue.publish("events", "early")  # not declared, no sub → dropped
        queue.subscribe_log("events", "late")
        queue.publish("events", "seen")
        assert [m.args for m in queue.read_topic("events", "late")] == [("seen",)]

    def test_list_declared_topics_and_retention_round_trip(self, queue: Queue) -> None:
        queue.declare_topic("orders", retention=1.5)
        queue.declare_topic("events")
        topics = {t["name"]: t for t in queue.list_declared_topics()}
        assert topics["orders"]["mode"] == "log"
        assert topics["orders"]["retention_ms"] == 1500
        assert topics["events"]["retention_ms"] is None

        # Idempotent re-declare updates retention without adding a row.
        queue.declare_topic("orders", retention=2.0)
        topics = {t["name"]: t for t in queue.list_declared_topics()}
        assert topics["orders"]["retention_ms"] == 2000
        assert len(queue.list_declared_topics()) == 2
