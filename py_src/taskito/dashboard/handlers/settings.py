"""Dashboard settings (key/value config) route handlers.

Settings are persisted via :class:`Storage` (one row per key) so every
worker and dashboard instance pointed at the same backend reads the same
values. The dashboard frontend stores JSON-encoded blobs (lists of
external links, integration URLs, branding overrides, etc.); the storage
layer treats them as opaque strings.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from taskito.dashboard.errors import _BadRequest, _NotFound

if TYPE_CHECKING:
    from taskito.app import Queue


_MAX_KEY_LENGTH = 256
_MAX_VALUE_LENGTH = 64 * 1024  # 64 KiB — enough for any realistic dashboard config blob


def _validate_key(key: str) -> None:
    """Reject empty / oversized / control-character keys."""
    if not key:
        raise _BadRequest("setting key must not be empty")
    if len(key) > _MAX_KEY_LENGTH:
        raise _BadRequest(f"setting key exceeds {_MAX_KEY_LENGTH} characters")
    if any(ord(c) < 32 or ord(c) == 127 for c in key):
        raise _BadRequest("setting key must not contain control characters")


def _validate_value(value: str) -> None:
    if len(value) > _MAX_VALUE_LENGTH:
        raise _BadRequest(f"setting value exceeds {_MAX_VALUE_LENGTH} bytes")


def _handle_list_settings(queue: Queue, _qs: dict) -> dict[str, str]:
    """Return all settings as a ``{key: value}`` dict."""
    return queue.list_settings()


def _handle_get_setting(queue: Queue, _qs: dict, key: str) -> dict[str, Any]:
    """Return a single setting, or 404 if it does not exist."""
    value = queue.get_setting(key)
    if value is None:
        raise _NotFound(f"setting '{key}' not found")
    return {"key": key, "value": value}


def _handle_set_setting(queue: Queue, body: dict, key: str) -> dict[str, Any]:
    """Insert or update a setting from a ``PUT`` body of ``{"value": ...}``."""
    _validate_key(key)
    if not isinstance(body, dict) or "value" not in body:
        raise _BadRequest("body must be a JSON object with a 'value' field")
    raw = body["value"]
    # Accept any JSON-serialisable type — re-encode for storage so callers
    # don't need to stringify themselves.
    value = raw if isinstance(raw, str) else json.dumps(raw, separators=(",", ":"))
    _validate_value(value)
    queue.set_setting(key, value)
    return {"key": key, "value": value}


def _handle_delete_setting(queue: Queue, key: str) -> dict[str, bool]:
    """Delete a setting. Returns ``{deleted: bool}``."""
    return {"deleted": queue.delete_setting(key)}
