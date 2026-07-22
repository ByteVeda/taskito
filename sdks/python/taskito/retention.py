"""Per-table retention windows."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Retention:
    """How long each history table keeps a row before auto-cleanup deletes it.

    Values are in seconds; ``None`` keeps a table forever. A job or DLQ entry
    can still carry its own per-entry ``result_ttl``, which is honored
    independently of these windows.

    Retention is **on by default**: a worker started with no ``retention``
    applies the recommended windows (archived jobs and metrics 7d, job errors
    7d, task logs 3d, dead-letter 30d). Pass a fully empty ``Retention()`` to
    disable the table-wide windows (a per-entry ``result_ttl`` is still honored);
    pass specific windows to override only those tables (the rest then keep
    forever).
    """

    archived_jobs: int | None = None
    """Terminal jobs — the artifact ``get_job`` reads after completion. Covers
    every terminal status, not just successes."""
    dead_letter: int | None = None
    """Dead-letter entries. The only copy of a payload a human must act on."""
    task_logs: int | None = None
    """Task logs — highest write volume, lowest per-row value."""
    task_metrics: int | None = None
    """Task metrics — feeds the dashboard charts."""
    job_errors: int | None = None
    """Per-attempt job errors."""

    def __post_init__(self) -> None:
        # Fail fast at construction: a negative window would invert the cleanup
        # cutoff into the future and match every row. Zero is valid (purge on
        # completion).
        for table, secs in self._as_map().items():
            if secs < 0:
                raise ValueError(f"retention window '{table}' must be non-negative")

    def _as_map(self) -> dict[str, int]:
        """The set windows as a ``{table: seconds}`` map for the native layer."""
        fields = {
            "archived_jobs": self.archived_jobs,
            "dead_letter": self.dead_letter,
            "task_logs": self.task_logs,
            "task_metrics": self.task_metrics,
            "job_errors": self.job_errors,
        }
        return {table: secs for table, secs in fields.items() if secs is not None}


#: History tables auto-cleanup purges, in the order operators read them —
#: shortest-lived first, the dead-letter queue last.
RETENTION_TABLES: tuple[str, ...] = (
    "task_logs",
    "archived_jobs",
    "job_errors",
    "task_metrics",
    "dead_letter",
)


@dataclass(frozen=True)
class EffectiveRetention:
    """The windows a worker is actually applying, as reported by the cleaner.

    Retention runs in the worker process, so this is published by the elected
    cleaner on each sweep rather than read from local config — a dashboard or
    admin script in another process sees the policy that governs the deletes.
    Windows are **milliseconds** (the wire unit); ``None`` keeps a table forever.
    """

    enabled: bool
    """False when no table has a window — only per-entry TTLs are swept."""
    defaulted: bool
    """True when the windows are the recommended defaults, set by no one."""
    namespace: str
    """Namespace the windows cover. The purges are not queue-scoped."""
    reported_at: int
    """When the cleaner last published this, in Unix milliseconds."""
    windows: dict[str, int | None]
    """``{table: window_ms}`` for every table in :data:`RETENTION_TABLES`."""

    @classmethod
    def _from_json(cls, raw: str) -> EffectiveRetention:
        """Parse the document the core publishes. See ``BINDING_CONTRACT.md``."""
        doc: dict[str, Any] = json.loads(raw)
        published: dict[str, Any] = doc.get("windows") or {}
        return cls(
            enabled=bool(doc.get("enabled", False)),
            defaulted=bool(doc.get("defaulted", False)),
            namespace=str(doc.get("namespace", "default")),
            reported_at=int(doc.get("reported_at", 0)),
            windows={table: published.get(f"{table}_ttl_ms") for table in RETENTION_TABLES},
        )
