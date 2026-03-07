"""Settings helper — reads TASKITO_* from Django settings and provides a singleton Queue."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from taskito.app import Queue

_queue_instance: Queue | None = None
_queue_lock = threading.Lock()


def _get_setting(name: str, default: Any = None) -> Any:
    from django.conf import settings

    return getattr(settings, name, default)


def get_queue() -> Queue:
    """Return a singleton Queue instance configured from Django settings."""
    global _queue_instance
    if _queue_instance is not None:
        return _queue_instance

    with _queue_lock:
        if _queue_instance is not None:
            return _queue_instance

        from taskito.app import Queue

        _queue_instance = Queue(
            db_path=_get_setting("TASKITO_DB_PATH", ".taskito/taskito.db"),
            workers=_get_setting("TASKITO_WORKERS", 0),
            default_retry=_get_setting("TASKITO_DEFAULT_RETRY", 3),
            default_timeout=_get_setting("TASKITO_DEFAULT_TIMEOUT", 300),
            default_priority=_get_setting("TASKITO_DEFAULT_PRIORITY", 0),
            result_ttl=_get_setting("TASKITO_RESULT_TTL", None),
            backend=_get_setting("TASKITO_BACKEND", "sqlite"),
            db_url=_get_setting("TASKITO_DB_URL", None),
            schema=_get_setting("TASKITO_SCHEMA", "taskito"),
        )
        return _queue_instance
