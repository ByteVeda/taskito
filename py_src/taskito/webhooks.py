"""Webhook delivery for job events."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import queue
import threading
import time
import urllib.parse
import urllib.request
from typing import Any

from taskito.events import EventType

logger = logging.getLogger("taskito.webhooks")


class WebhookManager:
    """Delivers webhook POST requests for job events.

    Uses a background daemon thread with a queue for non-blocking delivery.
    Each webhook is retried up to 3 times with exponential backoff.
    """

    def __init__(self) -> None:
        self._webhooks: list[dict[str, Any]] = []
        self._queue: queue.Queue[tuple[dict[str, Any], dict[str, Any]]] = queue.Queue()
        self._thread: threading.Thread | None = None
        self._thread_lock = threading.Lock()

    def add_webhook(
        self,
        url: str,
        events: list[EventType] | None = None,
        headers: dict[str, str] | None = None,
        secret: str | None = None,
    ) -> None:
        """Register a webhook endpoint.

        Args:
            url: URL to POST event payloads to.
            events: List of event types to subscribe to. None means all events.
            headers: Extra HTTP headers to include.
            secret: HMAC-SHA256 signing secret for the ``X-Taskito-Signature`` header.
        """
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"Webhook URL must use http:// or https://, got {parsed.scheme!r}")
        with self._thread_lock:
            self._webhooks.append(
                {
                    "url": url,
                    "events": {e.value for e in events} if events else None,
                    "headers": headers or {},
                    "secret": secret.encode() if secret else None,
                }
            )
        self._ensure_thread()

    def notify(self, event_type: EventType, payload: dict[str, Any]) -> None:
        """Queue an event for delivery to matching webhooks."""
        with self._thread_lock:
            webhooks = list(self._webhooks)
        for wh in webhooks:
            if wh["events"] is None or event_type.value in wh["events"]:
                self._queue.put((wh, {"event": event_type.value, **payload}))

    def _ensure_thread(self) -> None:
        with self._thread_lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(
                    target=self._deliver_loop, daemon=True, name="taskito-webhooks"
                )
                self._thread.start()

    def _deliver_loop(self) -> None:
        while True:
            try:
                wh, payload = self._queue.get(timeout=10)
                self._send(wh, payload)
            except queue.Empty:
                continue
            except Exception:
                logger.exception("Webhook delivery error")

    def _send(self, wh: dict[str, Any], payload: dict[str, Any]) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")

        headers: dict[str, str] = {
            "Content-Type": "application/json",
            **wh["headers"],
        }

        if wh["secret"]:
            sig = hmac.new(wh["secret"], body, hashlib.sha256).hexdigest()
            headers["X-Taskito-Signature"] = f"sha256={sig}"

        for attempt in range(3):
            try:
                req = urllib.request.Request(wh["url"], data=body, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    if resp.status < 400:
                        return
                    if resp.status < 500:
                        logger.warning(
                            "Webhook %s returned client error %d, not retrying",
                            wh["url"],
                            resp.status,
                        )
                        return
                    logger.warning("Webhook %s returned server error %d", wh["url"], resp.status)
            except Exception:
                logger.debug("Webhook %s attempt %d failed", wh["url"], attempt + 1, exc_info=True)
            if attempt == 2:
                logger.warning("Webhook delivery failed after 3 attempts: %s", wh["url"])
            else:
                time.sleep(2**attempt)
