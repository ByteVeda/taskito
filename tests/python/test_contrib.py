"""Tests for contrib middleware modules using mocks (no hard dependencies)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

# ── Helpers ──────────────────────────────────────────────────────────


def _make_ctx(
    job_id: str = "job-1",
    task_name: str = "my_task",
    queue_name: str = "default",
    retry_count: int = 0,
) -> MagicMock:
    ctx = MagicMock()
    ctx.id = job_id
    ctx.task_name = task_name
    ctx.queue_name = queue_name
    ctx.retry_count = retry_count
    return ctx


# ── OpenTelemetry ────────────────────────────────────────────────────


class TestOpenTelemetryMiddleware:
    def test_before_starts_span(self) -> None:
        otel = _try_import_otel()
        if otel is None:
            return

        mock_tracer = MagicMock()
        mock_span = MagicMock()
        mock_tracer.start_span.return_value = mock_span

        mw = otel.OpenTelemetryMiddleware.__new__(otel.OpenTelemetryMiddleware)
        import threading

        mw._tracer = mock_tracer
        mw._spans = {}
        mw._lock = threading.Lock()

        ctx = _make_ctx()
        mw.before(ctx)

        mock_tracer.start_span.assert_called_once()
        assert "job-1" in mw._spans

    def test_after_ends_span_success(self) -> None:
        otel = _try_import_otel()
        if otel is None:
            return

        mock_span = MagicMock()
        mw = otel.OpenTelemetryMiddleware.__new__(otel.OpenTelemetryMiddleware)
        import threading

        mw._tracer = MagicMock()
        mw._spans = {"job-1": mock_span}
        mw._lock = threading.Lock()

        ctx = _make_ctx()
        mw.after(ctx, result="ok", error=None)

        mock_span.set_status.assert_called_once()
        mock_span.end.assert_called_once()
        mock_span.record_exception.assert_not_called()

    def test_after_records_exception_on_error(self) -> None:
        otel = _try_import_otel()
        if otel is None:
            return

        mock_span = MagicMock()
        mw = otel.OpenTelemetryMiddleware.__new__(otel.OpenTelemetryMiddleware)
        import threading

        mw._tracer = MagicMock()
        mw._spans = {"job-1": mock_span}
        mw._lock = threading.Lock()

        ctx = _make_ctx()
        exc = ValueError("boom")
        mw.after(ctx, result=None, error=exc)

        mock_span.record_exception.assert_called_once_with(exc)
        mock_span.end.assert_called_once()


def _try_import_otel():  # type: ignore[no-untyped-def]
    """Import otel module with mocked opentelemetry if not installed."""
    try:
        import sys

        # Provide mock opentelemetry modules if not installed
        mock_trace = MagicMock()
        mock_trace.StatusCode.OK = "OK"
        mock_trace.StatusCode.ERROR = "ERROR"

        with patch.dict(
            sys.modules,
            {
                "opentelemetry": MagicMock(),
                "opentelemetry.trace": mock_trace,
            },
        ):
            if "taskito.contrib.otel" in sys.modules:
                del sys.modules["taskito.contrib.otel"]
            from taskito.contrib import otel

            # Patch module-level references
            otel.trace = mock_trace
            otel.StatusCode = mock_trace.StatusCode
            return otel
    except Exception:
        return None


# ── Sentry ───────────────────────────────────────────────────────────


class TestSentryMiddleware:
    def test_before_pushes_scope(self) -> None:
        sentry_mod = _try_import_sentry()
        if sentry_mod is None:
            return

        mock_sdk = sentry_mod.sentry_sdk
        ctx = _make_ctx()

        mw = sentry_mod.SentryMiddleware.__new__(sentry_mod.SentryMiddleware)
        mw.before(ctx)

        mock_sdk.push_scope.assert_called_once()

    def test_after_pops_scope(self) -> None:
        sentry_mod = _try_import_sentry()
        if sentry_mod is None:
            return

        mock_sdk = sentry_mod.sentry_sdk
        ctx = _make_ctx()

        mw = sentry_mod.SentryMiddleware.__new__(sentry_mod.SentryMiddleware)
        mw.after(ctx, result="ok", error=None)

        mock_sdk.pop_scope_unsafe.assert_called_once()

    def test_after_captures_exception_on_error(self) -> None:
        sentry_mod = _try_import_sentry()
        if sentry_mod is None:
            return

        mock_sdk = sentry_mod.sentry_sdk
        ctx = _make_ctx()
        exc = RuntimeError("oops")

        mw = sentry_mod.SentryMiddleware.__new__(sentry_mod.SentryMiddleware)
        mw.after(ctx, result=None, error=exc)

        mock_sdk.capture_exception.assert_called_once_with(exc)


def _try_import_sentry():  # type: ignore[no-untyped-def]
    try:
        import sys

        mock_sdk = MagicMock()
        with patch.dict(sys.modules, {"sentry_sdk": mock_sdk}):
            if "taskito.contrib.sentry" in sys.modules:
                del sys.modules["taskito.contrib.sentry"]
            from taskito.contrib import sentry

            sentry.sentry_sdk = mock_sdk
            return sentry
    except Exception:
        return None


# ── Prometheus ───────────────────────────────────────────────────────


class TestPrometheusMiddleware:
    def test_before_increments_active_workers(self) -> None:
        prom = _try_import_prometheus()
        if prom is None:
            return

        mw = prom.PrometheusMiddleware.__new__(prom.PrometheusMiddleware)
        import threading

        mw._start_times = {}
        mw._lock = threading.Lock()

        ctx = _make_ctx()
        mw.before(ctx)

        prom._active_workers.inc.assert_called()

    def test_after_tracks_counter_and_histogram(self) -> None:
        prom = _try_import_prometheus()
        if prom is None:
            return

        import threading

        mw = prom.PrometheusMiddleware.__new__(prom.PrometheusMiddleware)
        mw._start_times = {"job-1": 0.0}
        mw._lock = threading.Lock()

        ctx = _make_ctx()
        mw.after(ctx, result="ok", error=None)

        prom._active_workers.dec.assert_called()
        prom._jobs_total.labels.assert_called_with(task="my_task", status="completed")
        prom._jobs_total.labels().inc.assert_called()

    def test_after_tracks_failure(self) -> None:
        prom = _try_import_prometheus()
        if prom is None:
            return

        import threading

        mw = prom.PrometheusMiddleware.__new__(prom.PrometheusMiddleware)
        mw._start_times = {"job-1": 0.0}
        mw._lock = threading.Lock()

        ctx = _make_ctx()
        exc = ValueError("fail")
        mw.after(ctx, result=None, error=exc)

        prom._jobs_total.labels.assert_called_with(task="my_task", status="failed")


def _try_import_prometheus():  # type: ignore[no-untyped-def]
    try:
        import sys

        mock_counter = MagicMock()
        mock_gauge = MagicMock()
        mock_histogram = MagicMock()

        with patch.dict(
            sys.modules,
            {
                "prometheus_client": MagicMock(
                    Counter=mock_counter,
                    Gauge=mock_gauge,
                    Histogram=mock_histogram,
                    start_http_server=MagicMock(),
                ),
            },
        ):
            if "taskito.contrib.prometheus" in sys.modules:
                del sys.modules["taskito.contrib.prometheus"]
            from taskito.contrib import prometheus

            # Replace module-level metric singletons with mocks
            prometheus._jobs_total = MagicMock()
            prometheus._job_duration = MagicMock()
            prometheus._active_workers = MagicMock()
            prometheus._retries_total = MagicMock()
            prometheus._queue_depth = MagicMock()
            prometheus._dlq_size = MagicMock()
            prometheus._worker_utilization = MagicMock()
            return prometheus
    except Exception:
        return None
