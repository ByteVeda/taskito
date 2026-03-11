"""Prometheus metrics integration for taskito.

Requires the ``prometheus`` extra::

    pip install taskito[prometheus]

Usage::

    from taskito.contrib.prometheus import PrometheusMiddleware, start_metrics_server

    queue = Queue(middleware=[PrometheusMiddleware()])
    start_metrics_server(port=9090)  # optional standalone metrics endpoint
"""

from __future__ import annotations

import logging
import threading
import time
from typing import TYPE_CHECKING, Any

from taskito.middleware import TaskMiddleware

if TYPE_CHECKING:
    from taskito.app import Queue
    from taskito.context import JobContext

logger = logging.getLogger("taskito.prometheus")

try:
    from prometheus_client import Counter, Gauge, Histogram, start_http_server
except ImportError:
    Counter = None
    Gauge = None
    Histogram = None
    start_http_server = None

# Module-level metric singletons (created once on first middleware init)
_jobs_total: Any = None
_job_duration: Any = None
_active_workers: Any = None
_retries_total: Any = None
_queue_depth: Any = None
_dlq_size: Any = None
_worker_utilization: Any = None
_resource_health: Any = None
_resource_recreations: Any = None
_resource_init_duration: Any = None
_proxy_reconstruct_duration: Any = None
_proxy_reconstruct_total: Any = None
_proxy_reconstruct_errors: Any = None
_intercept_duration: Any = None
_intercept_strategy_total: Any = None
_pool_size: Any = None
_pool_active: Any = None
_pool_idle: Any = None
_pool_timeouts: Any = None
_metrics_initialized = False


_init_lock = threading.Lock()


def _init_metrics() -> None:
    global _jobs_total, _job_duration, _active_workers, _retries_total
    global _queue_depth, _dlq_size, _worker_utilization, _metrics_initialized
    global _resource_health, _resource_recreations, _resource_init_duration
    global _proxy_reconstruct_duration, _proxy_reconstruct_total
    global _proxy_reconstruct_errors, _intercept_duration
    global _intercept_strategy_total
    global _pool_size, _pool_active, _pool_idle, _pool_timeouts

    if _metrics_initialized:
        return

    with _init_lock:
        if _metrics_initialized:
            return

        _jobs_total = Counter(
            "taskito_jobs_total",
            "Total number of jobs processed",
            ["task", "status"],
        )
        _job_duration = Histogram(
            "taskito_job_duration_seconds",
            "Job execution duration in seconds",
            ["task"],
        )
        _active_workers = Gauge(
            "taskito_active_workers",
            "Number of currently active workers",
        )
        _retries_total = Counter(
            "taskito_retries_total",
            "Total number of job retries",
            ["task"],
        )
        _queue_depth = Gauge(
            "taskito_queue_depth",
            "Number of pending jobs per queue",
            ["queue"],
        )
        _dlq_size = Gauge(
            "taskito_dlq_size",
            "Number of dead-letter jobs",
        )
        _worker_utilization = Gauge(
            "taskito_worker_utilization",
            "Worker utilization ratio (0.0-1.0)",
        )
        _resource_health = Gauge(
            "taskito_resource_health_status",
            "Resource health (1=healthy, 0=unhealthy)",
            ["resource"],
        )
        _resource_recreations = Gauge(
            "taskito_resource_recreation_total",
            "Total recreations per resource",
            ["resource"],
        )
        _resource_init_duration = Gauge(
            "taskito_resource_init_duration_seconds",
            "Time to initialize each resource",
            ["resource"],
        )
        _proxy_reconstruct_duration = Histogram(
            "taskito_proxy_reconstruct_duration_seconds",
            "Proxy reconstruction duration",
            ["handler"],
        )
        _proxy_reconstruct_total = Counter(
            "taskito_proxy_reconstruct_total",
            "Total proxy reconstructions",
            ["handler"],
        )
        _proxy_reconstruct_errors = Counter(
            "taskito_proxy_reconstruct_errors_total",
            "Total proxy reconstruction errors",
            ["handler"],
        )
        _intercept_duration = Histogram(
            "taskito_intercept_duration_seconds",
            "Argument interception duration",
        )
        _intercept_strategy_total = Counter(
            "taskito_intercept_strategy_total",
            "Interception strategy counts",
            ["strategy"],
        )
        _pool_size = Gauge(
            "taskito_resource_pool_size",
            "Resource pool max size",
            ["resource"],
        )
        _pool_active = Gauge(
            "taskito_resource_pool_active",
            "Active pool instances",
            ["resource"],
        )
        _pool_idle = Gauge(
            "taskito_resource_pool_idle",
            "Idle pool instances",
            ["resource"],
        )
        _pool_timeouts = Counter(
            "taskito_resource_pool_timeout_total",
            "Pool acquisition timeouts",
            ["resource"],
        )
        _metrics_initialized = True


class PrometheusMiddleware(TaskMiddleware):
    """Middleware that exports Prometheus metrics for task execution.

    Tracks:
    - ``taskito_jobs_total{task,status}`` — counter of completed/failed jobs
    - ``taskito_job_duration_seconds{task}`` — histogram of execution times
    - ``taskito_active_workers`` — gauge of currently executing workers
    - ``taskito_retries_total{task}`` — counter of retry attempts
    """

    def __init__(self) -> None:
        if Counter is None:
            raise ImportError(
                "prometheus-client is required for PrometheusMiddleware. "
                "Install it with: pip install taskito[prometheus]"
            )
        _init_metrics()
        self._start_times: dict[str, float] = {}
        self._lock = threading.Lock()

    def before(self, ctx: JobContext) -> None:
        with self._lock:
            self._start_times[ctx.id] = time.monotonic()
        _active_workers.inc()

    def after(self, ctx: JobContext, result: Any, error: Exception | None) -> None:
        _active_workers.dec()
        status = "failed" if error is not None else "completed"
        _jobs_total.labels(task=ctx.task_name, status=status).inc()

        with self._lock:
            start = self._start_times.pop(ctx.id, None)
        if start is not None:
            duration = time.monotonic() - start
            _job_duration.labels(task=ctx.task_name).observe(duration)

    def on_retry(self, ctx: JobContext, error: Exception, retry_count: int) -> None:
        _retries_total.labels(task=ctx.task_name).inc()


class PrometheusStatsCollector:
    """Daemon thread that polls queue stats and updates Prometheus gauges.

    Usage::

        collector = PrometheusStatsCollector(queue, interval=10)
        collector.start()
    """

    def __init__(self, queue: Queue, interval: float = 10.0):
        if Counter is None:
            raise ImportError(
                "prometheus-client is required for PrometheusStatsCollector. "
                "Install it with: pip install taskito[prometheus]"
            )
        _init_metrics()
        self._queue = queue
        self._interval = interval
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        self._thread = threading.Thread(target=self._poll, daemon=True, name="taskito-prom-stats")
        self._thread.start()

    def stop(self) -> None:
        """Signal the collector to stop and wait for the thread to finish."""
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _poll(self) -> None:
        while not self._stop_event.is_set():
            try:
                stats = self._queue.stats()
                _dlq_size.set(stats.get("dead", 0))

                running = stats.get("running", 0)
                total_workers = self._queue._workers
                if total_workers > 0:
                    _worker_utilization.set(running / total_workers)

                # Per-queue depth
                try:
                    all_q = self._queue.stats_all_queues()
                    for q_name, q_stats in all_q.items():
                        _queue_depth.labels(queue=q_name).set(q_stats.get("pending", 0))
                except Exception:
                    _queue_depth.labels(queue="default").set(stats.get("pending", 0))
            except Exception:
                logger.debug("Stats collection failed", exc_info=True)

            # Resource metrics (including pool stats)
            try:
                for res in self._queue.resource_status():
                    name = res["name"]
                    _resource_health.labels(resource=name).set(
                        1.0 if res["health"] == "healthy" else 0.0
                    )
                    _resource_recreations.labels(resource=name).set(res["recreations"])
                    _resource_init_duration.labels(resource=name).set(
                        res["init_duration_ms"] / 1000.0
                    )
                    pool = res.get("pool")
                    if pool:
                        _pool_size.labels(resource=name).set(pool["size"])
                        _pool_active.labels(resource=name).set(pool["active"])
                        _pool_idle.labels(resource=name).set(pool["idle"])
                        _pool_timeouts.labels(resource=name).set(pool["total_timeouts"])
            except Exception:
                logger.debug("Resource metrics collection failed", exc_info=True)

            # Proxy reconstruction metrics
            try:
                for pstat in self._queue.proxy_stats():
                    handler = pstat["handler"]
                    _proxy_reconstruct_total.labels(handler=handler)._value.set(
                        pstat["total_reconstructions"]
                    )
                    _proxy_reconstruct_errors.labels(handler=handler)._value.set(
                        pstat["total_errors"]
                    )
            except Exception:
                logger.debug("Proxy metrics collection failed", exc_info=True)

            # Interception metrics
            try:
                istats = self._queue.interception_stats()
                if istats:
                    for strategy, count in istats.get("strategy_counts", {}).items():
                        _intercept_strategy_total.labels(strategy=strategy)._value.set(count)
            except Exception:
                logger.debug("Interception metrics collection failed", exc_info=True)

            self._stop_event.wait(self._interval)


def start_metrics_server(port: int = 9090) -> None:
    """Start a standalone Prometheus metrics HTTP server.

    Args:
        port: Port to bind to (default: 9090).
    """
    if start_http_server is None:
        raise ImportError(
            "prometheus-client is required. Install with: pip install taskito[prometheus]"
        )
    start_http_server(port)
