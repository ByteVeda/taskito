"""Main argument interceptor — orchestrates the full interception pipeline."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from taskito.interception.errors import InterceptionError
from taskito.interception.registry import TypeRegistry
from taskito.interception.strategy import Strategy
from taskito.interception.walker import ArgumentWalker

if TYPE_CHECKING:
    from taskito.interception.metrics import InterceptionMetrics
    from taskito.proxies.registry import ProxyRegistry

logger = logging.getLogger("taskito.interception")


@dataclass
class InterceptionReport:
    """Human-readable report of what the interceptor would do with given arguments."""

    entries: list[ReportEntry] = field(default_factory=list)

    def __str__(self) -> str:
        lines = ["Argument Analysis:"]
        for e in self.entries:
            arrow = f"→ {e.strategy.value.upper()}"
            detail = f" ({e.detail})" if e.detail else ""
            lines.append(f"  {e.path:<30s} ({e.type_name:<20s}) {arrow}{detail}")
        return "\n".join(lines)


@dataclass
class ReportEntry:
    """Single entry in an interception report."""

    path: str
    type_name: str
    strategy: Strategy
    detail: str = ""


class ArgumentInterceptor:
    """Orchestrates argument interception before serialization.

    Three modes:
    - ``"strict"``: REJECT raises immediately, unknown non-serializable types raise.
    - ``"lenient"``: REJECT logs a warning and drops the argument, unknowns pass through.
    - ``"off"``: No interception at all — passthrough to serializer.
    """

    def __init__(
        self,
        registry: TypeRegistry,
        mode: str = "strict",
        max_depth: int = 10,
        proxy_registry: ProxyRegistry | None = None,
        metrics: InterceptionMetrics | None = None,
    ) -> None:
        if mode not in ("strict", "lenient", "off"):
            raise ValueError(
                f"Invalid interception mode: {mode!r}. Use 'strict', 'lenient', or 'off'."
            )
        self._registry = registry
        self._mode = mode
        self._walker = ArgumentWalker(registry, max_depth=max_depth, proxy_registry=proxy_registry)
        self._metrics = metrics

    @property
    def mode(self) -> str:
        return self._mode

    def intercept(self, args: tuple, kwargs: dict) -> tuple[tuple, dict]:
        """Intercept arguments, transforming them according to their strategies.

        Returns:
            Transformed (args, kwargs) ready for serialization.

        Raises:
            InterceptionError: In strict mode, if any arguments are rejected.
        """
        if self._mode == "off":
            return args, kwargs

        start = time.monotonic()
        new_args, new_kwargs, walk_result = self._walker.walk(args, kwargs)
        duration_ms = (time.monotonic() - start) * 1000

        if self._metrics is not None:
            self._metrics.record(
                duration_ms=duration_ms,
                strategies=walk_result.strategy_counts,
                max_depth=walk_result.max_depth,
            )

        if walk_result.failures:
            if self._mode == "strict":
                raise InterceptionError(walk_result.failures)
            # Lenient mode: log warnings, strip rejected values
            for f in walk_result.failures:
                logger.warning(
                    "Argument %s (%s) rejected: %s — dropping from payload",
                    f.path,
                    f.type_name,
                    f.reason,
                )
            new_args, new_kwargs = self._strip_rejected(new_args, new_kwargs, walk_result)

        return new_args, new_kwargs

    def analyze(self, args: tuple, kwargs: dict) -> InterceptionReport:
        """Analyze arguments without transforming them. Returns a human-readable report."""
        if self._mode == "off":
            return InterceptionReport()

        report = InterceptionReport()
        self._analyze_values(args, kwargs, report)
        return report

    def _analyze_values(self, args: tuple, kwargs: dict, report: InterceptionReport) -> None:
        """Walk args/kwargs and build report entries."""
        for i, v in enumerate(args):
            self._analyze_single(v, f"args[{i}]", report)
        for k, v in kwargs.items():
            self._analyze_single(v, f"kwargs.{k}", report)

    def _analyze_single(self, obj: Any, path: str, report: InterceptionReport) -> None:
        """Analyze a single value for the report."""
        import dataclasses as dc

        if obj is None:
            report.entries.append(
                ReportEntry(path=path, type_name="NoneType", strategy=Strategy.PASS)
            )
            return

        # Dataclass check
        if dc.is_dataclass(obj) and not isinstance(obj, type):
            entry = self._registry.resolve(obj)
            if entry is not None:
                report.entries.append(
                    ReportEntry(
                        path=path,
                        type_name=type(obj).__qualname__,
                        strategy=entry.strategy,
                        detail=self._detail_for(entry),
                    )
                )
            else:
                report.entries.append(
                    ReportEntry(
                        path=path,
                        type_name=type(obj).__qualname__,
                        strategy=Strategy.CONVERT,
                        detail="auto-detected dataclass",
                    )
                )
            return

        entry = self._registry.resolve(obj)
        if entry is not None:
            report.entries.append(
                ReportEntry(
                    path=path,
                    type_name=type(obj).__qualname__,
                    strategy=entry.strategy,
                    detail=self._detail_for(entry),
                )
            )
        else:
            # Not in registry — unknown type
            report.entries.append(
                ReportEntry(
                    path=path,
                    type_name=type(obj).__qualname__,
                    strategy=Strategy.PASS,
                    detail="unknown type, passed to serializer",
                )
            )

    @staticmethod
    def _detail_for(entry: Any) -> str:
        """Build detail string for a report entry."""
        if entry.strategy == Strategy.REDIRECT:
            return f"redirect to worker resource '{entry.redirect_resource}'"
        if entry.strategy == Strategy.REJECT:
            return entry.reject_reason or ""
        if entry.strategy == Strategy.CONVERT:
            return f"type_key={entry.type_key}" if entry.type_key else ""
        if entry.strategy == Strategy.PROXY:
            return f"handler={entry.proxy_handler}" if entry.proxy_handler else ""
        return ""

    @staticmethod
    def _strip_rejected(args: tuple, kwargs: dict, walk_result: Any) -> tuple[tuple, dict]:
        """In lenient mode, strip REJECT-ed values from args/kwargs.

        Rejected positional args become None. Rejected kwargs are removed.
        """
        failed_paths = {f.path for f in walk_result.failures}
        new_args = tuple(None if f"args[{i}]" in failed_paths else v for i, v in enumerate(args))
        new_kwargs = {k: v for k, v in kwargs.items() if f"kwargs.{k}" not in failed_paths}
        return new_args, new_kwargs
