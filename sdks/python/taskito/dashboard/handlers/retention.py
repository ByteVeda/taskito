"""Retention route handler.

Echoes the windows the elected cleaner published for this namespace, so the
dashboard can explain why rows disappear from its listings. Retention runs in
the worker process, so this is never computed from local config — an
unreported policy is reported as such rather than guessed at.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from taskito.retention import RETENTION_TABLES, EffectiveRetention

if TYPE_CHECKING:
    from taskito.app import Queue


def _windows(snapshot: EffectiveRetention | None) -> dict[str, int | None]:
    """Every table's window in ms, ``None`` for keep-forever and unreported."""
    windows = snapshot.windows if snapshot else {}
    return {f"{table}_ttl_ms": windows.get(table) for table in RETENTION_TABLES}


def _handle_retention(queue: Queue, _qs: dict) -> dict[str, Any]:
    """Return the published retention policy for this queue's namespace."""
    snapshot = queue.effective_retention()
    return {
        # Distinct from `enabled`: no worker has swept yet, so nothing is known
        # about the policy — not the same as retention being switched off.
        "reported": snapshot is not None,
        "enabled": snapshot.enabled if snapshot else False,
        "defaulted": snapshot.defaulted if snapshot else False,
        "namespace": snapshot.namespace if snapshot else None,
        "reported_at": snapshot.reported_at if snapshot else None,
        "windows": _windows(snapshot),
    }
