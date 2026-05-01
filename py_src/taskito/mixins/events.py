"""Event bus and webhook registration."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from taskito.events import EventBus, EventType
    from taskito.webhooks import WebhookManager


class QueueEventsMixin:
    """Event emission, lifecycle event listeners, and webhook registration."""

    _event_bus: EventBus
    _webhook_manager: WebhookManager

    def _emit_event(self, event_type: EventType, payload: dict[str, Any]) -> None:
        """Emit an event to the event bus and webhook manager."""
        self._event_bus.emit(event_type, payload)
        self._webhook_manager.notify(event_type, payload)

    def on_event(self, event_type: EventType, callback: Callable[..., Any]) -> None:
        """Register a callback for a job lifecycle event.

        Args:
            event_type: The event type to listen for.
            callback: Called with ``(event_type, payload_dict)``.
        """
        self._event_bus.on(event_type, callback)

    def add_webhook(
        self,
        url: str,
        events: list[EventType] | None = None,
        headers: dict[str, str] | None = None,
        secret: str | None = None,
        max_retries: int = 3,
        timeout: float = 10.0,
        retry_backoff: float = 2.0,
    ) -> None:
        """Register a webhook endpoint for job events.

        Args:
            url: URL to POST event payloads to.
            events: Event types to subscribe to (None = all).
            headers: Extra HTTP headers.
            secret: HMAC-SHA256 signing secret.
            max_retries: Maximum delivery attempts (default 3).
            timeout: HTTP request timeout in seconds (default 10.0).
            retry_backoff: Base for exponential backoff between retries (default 2.0).
        """
        self._webhook_manager.add_webhook(
            url,
            events,
            headers,
            secret,
            max_retries=max_retries,
            timeout=timeout,
            retry_backoff=retry_backoff,
        )
