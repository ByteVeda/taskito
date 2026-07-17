"""Per-table retention windows."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Retention:
    """How long each history table keeps a row before auto-cleanup deletes it.

    Values are in seconds; ``None`` keeps a table forever. A job or DLQ entry
    can still carry its own per-entry ``result_ttl``, which is honored
    independently of these windows.
    """

    archived_jobs: int | None = None
    """Terminal jobs — the artifact ``get_job`` reads after completion. Covers
    every status on SQLite/Postgres; the Redis backend currently purges only
    ``Complete`` archive rows."""
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
