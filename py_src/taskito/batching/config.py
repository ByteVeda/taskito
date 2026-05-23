"""Configuration for batched tasks."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BatchConfig:
    """Tunables for a batched task.

    Attributes:
        max_size: Flush the batch as soon as this many items have accumulated.
            A larger value means higher throughput but worse latency.
        max_wait_ms: Flush an idle batch after this many milliseconds even if
            ``max_size`` has not been reached. Bounds the worst-case latency
            of any single batched call.
    """

    max_size: int = 100
    max_wait_ms: int = 500

    def __post_init__(self) -> None:
        if self.max_size < 1:
            raise ValueError(f"batch max_size must be >= 1, got {self.max_size}")
        if self.max_wait_ms < 1:
            raise ValueError(f"batch max_wait_ms must be >= 1, got {self.max_wait_ms}")

    @classmethod
    def normalize(cls, value: Any) -> BatchConfig | None:
        """Convert the ``batch=`` decorator kwarg into a config (or ``None``).

        ``None`` / ``False`` disable batching; ``True`` uses defaults; a dict
        overrides specific fields. Any other input raises ``TypeError``.
        """
        if value is None or value is False:
            return None
        if value is True:
            return cls()
        if isinstance(value, BatchConfig):
            return value
        if isinstance(value, dict):
            kwargs: dict[str, Any] = {}
            if "max_size" in value:
                kwargs["max_size"] = int(value["max_size"])
            if "max_wait_ms" in value:
                kwargs["max_wait_ms"] = int(value["max_wait_ms"])
            return cls(**kwargs)
        raise TypeError(
            f"batch= must be bool, dict, BatchConfig, or None — got {type(value).__name__}"
        )
