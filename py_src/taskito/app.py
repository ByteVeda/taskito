"""Main Queue class and @task decorator."""

from __future__ import annotations

import asyncio
import contextlib
import functools
import json
import logging
import os
import signal
import threading
import urllib.parse
import uuid
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from taskito.testing import TestMode

from taskito._taskito import PyQueue, PyTaskConfig
from taskito.async_support.helpers import run_maybe_async
from taskito.async_support.mixins import AsyncQueueMixin
from taskito.events import EventBus, EventType
from taskito.interception import ArgumentInterceptor
from taskito.interception.built_in import build_default_registry
from taskito.middleware import TaskMiddleware
from taskito.mixins import (
    QueueInspectionMixin,
    QueueLockMixin,
    QueueOperationsMixin,
)
from taskito.proxies import ProxyRegistry, cleanup_proxies, reconstruct_proxies
from taskito.proxies.built_in import register_builtin_handlers
from taskito.proxies.metrics import ProxyMetrics
from taskito.resources.definition import ResourceDefinition, ResourceScope
from taskito.resources.runtime import ResourceRuntime
from taskito.result import JobResult
from taskito.serializers import CloudpickleSerializer, Serializer
from taskito.task import TaskWrapper
from taskito.webhooks import WebhookManager

logger = logging.getLogger("taskito")


def _resolve_module_name(module_name: str) -> str:
    """Resolve __main__ to the actual module name."""
    if module_name != "__main__":
        return module_name
    import sys

    main = sys.modules.get("__main__")
    if main is not None:
        spec = getattr(main, "__spec__", None)
        if spec and spec.name:
            return str(spec.name)
        f = getattr(main, "__file__", None)
        if f:
            return str(os.path.splitext(os.path.basename(f))[0])
    return module_name


class Queue(
    QueueInspectionMixin,
    QueueOperationsMixin,
    QueueLockMixin,
    AsyncQueueMixin,
):
    """
    Rust-powered task queue with embedded SQLite storage.

    Usage::

        queue = Queue()

        @queue.task()
        def send_email(to, subject, body):
            ...

        job = send_email.delay("user@example.com", "Hello", "World")
        queue.run_worker()  # in another process/thread
    """

    def __init__(
        self,
        db_path: str = ".taskito/taskito.db",
        workers: int = 0,
        default_retry: int = 3,
        default_timeout: int = 300,
        default_priority: int = 0,
        result_ttl: int | None = None,
        serializer: Serializer | None = None,
        middleware: list[TaskMiddleware] | None = None,
        backend: str = "sqlite",
        db_url: str | None = None,
        schema: str = "taskito",
        pool_size: int | None = None,
        drain_timeout: int = 30,
        interception: str = "off",
        max_intercept_depth: int = 10,
        recipe_signing_key: str | None = None,
        max_reconstruction_timeout: int = 10,
        file_path_allowlist: list[str] | None = None,
        disabled_proxies: list[str] | None = None,
        async_concurrency: int = 100,
        event_workers: int = 4,
        scheduler_poll_interval_ms: int = 50,
        scheduler_reap_interval: int = 100,
        scheduler_cleanup_interval: int = 1200,
        namespace: str | None = None,
    ):
        """Initialize a new task queue.

        Args:
            db_path: Path to the SQLite database file. Defaults to
                ``.taskito/taskito.db``. Parent directories are created
                automatically. Ignored when backend is ``"postgres"``.
            workers: Number of worker threads (0 = auto-detect CPU count).
            default_retry: Default max retry attempts for tasks.
            default_timeout: Default task timeout in seconds.
            default_priority: Default task priority (higher = more urgent).
            result_ttl: Auto-cleanup completed/dead jobs older than this many
                seconds. None disables auto-cleanup.
            serializer: Serializer for task payloads. Defaults to CloudpickleSerializer.
            middleware: List of global middleware instances applied to all tasks.
            backend: Storage backend — ``"sqlite"`` (default) or ``"postgres"``.
            db_url: PostgreSQL connection URL (required when backend is ``"postgres"``).
                Example: ``"postgresql://user:pass@localhost/taskito"``.
            schema: PostgreSQL schema name for all taskito tables. Defaults to
                ``"taskito"``. Ignored when backend is ``"sqlite"``.
            pool_size: Maximum number of connections in the database connection
                pool. Defaults to 10. Useful for managed services like Supabase
                that have low connection limits.
            drain_timeout: Seconds to wait for in-flight jobs to finish during
                graceful shutdown. Defaults to 30.
            interception: Argument interception mode — ``"strict"`` (reject
                non-serializable args), ``"lenient"`` (warn and drop), or
                ``"off"`` (disabled, default). See :mod:`taskito.interception`.
            max_intercept_depth: Maximum recursion depth for argument walking.
                Defaults to 10.
            recipe_signing_key: HMAC-SHA256 key for proxy recipe integrity.
                Falls back to ``TASKITO_RECIPE_SECRET`` env var.
            max_reconstruction_timeout: Max seconds for proxy reconstruction.
            file_path_allowlist: Allowed file paths for the file proxy handler.
            disabled_proxies: Handler names to skip when registering built-in
                proxy handlers.
            async_concurrency: Maximum number of async tasks running concurrently
                on the native async executor. Defaults to 100.
            event_workers: Thread pool size for the event bus (default 4).
            scheduler_poll_interval_ms: Milliseconds between scheduler poll
                cycles (default 50).
            scheduler_reap_interval: Reap stale jobs every N poll iterations
                (default 100).
            scheduler_cleanup_interval: Cleanup old jobs every N poll iterations
                (default 1200).
        """
        if backend == "sqlite":
            # Ensure parent directory exists for SQLite
            db_dir = os.path.dirname(db_path)
            if db_dir:
                os.makedirs(db_dir, exist_ok=True)

        self._inner = PyQueue(
            db_path=db_path,
            workers=workers,
            default_retry=default_retry,
            default_timeout=default_timeout,
            default_priority=default_priority,
            result_ttl=result_ttl,
            backend=backend,
            db_url=db_url,
            schema=schema,
            pool_size=pool_size,
            scheduler_poll_interval_ms=scheduler_poll_interval_ms,
            scheduler_reap_interval=scheduler_reap_interval,
            scheduler_cleanup_interval=scheduler_cleanup_interval,
            namespace=namespace,
        )
        self._backend = backend
        self._namespace = namespace
        self._db_url = db_url
        self._schema = schema
        self._db_path = db_path
        self._workers = workers or os.cpu_count() or 1
        self._task_registry: dict[str, Callable] = {}
        self._task_configs: list[PyTaskConfig] = []
        self._executor = ThreadPoolExecutor(max_workers=2)
        self._periodic_configs: list[dict[str, Any]] = []
        self._hooks: dict[str, list[Callable]] = {
            "before_task": [],
            "after_task": [],
            "on_success": [],
            "on_failure": [],
        }
        self._serializer: Serializer = serializer or CloudpickleSerializer()
        self._task_serializers: dict[str, Serializer] = {}
        self._global_middleware: list[TaskMiddleware] = middleware or []
        self._task_middleware: dict[str, list[TaskMiddleware]] = {}
        self._task_retry_filters: dict[str, dict[str, list[type[Exception]]]] = {}
        self._drain_timeout = drain_timeout
        self._queue_configs: dict[str, dict[str, Any]] = {}
        self._event_bus = EventBus(max_workers=event_workers)
        self._webhook_manager = WebhookManager()

        # Proxy handlers
        self._proxy_registry = ProxyRegistry()
        register_builtin_handlers(
            self._proxy_registry,
            disabled_proxies=disabled_proxies,
            file_path_allowlist=file_path_allowlist,
        )
        self._proxy_metrics = ProxyMetrics()
        self._recipe_signing_key = recipe_signing_key or os.environ.get("TASKITO_RECIPE_SECRET")
        self._max_reconstruction_timeout = max_reconstruction_timeout

        # Argument interception
        self._interception_metrics = None
        if interception != "off":
            from taskito.interception.metrics import InterceptionMetrics

            self._interception_metrics = InterceptionMetrics()
            registry = build_default_registry()
            self._interceptor: ArgumentInterceptor | None = ArgumentInterceptor(
                registry=registry,
                mode=interception,
                max_depth=max_intercept_depth,
                proxy_registry=self._proxy_registry,
                metrics=self._interception_metrics,
            )
        else:
            self._interceptor = None

        # Worker resources (dependency injection)
        self._resource_definitions: dict[str, ResourceDefinition] = {}
        self._resource_runtime: ResourceRuntime | None = None
        self._task_inject_map: dict[str, list[str]] = {}

        # Native async concurrency limit
        self._async_concurrency = async_concurrency

        # Test mode flag (Phase M)
        self._test_mode_active = False

    def task(
        self,
        name: str | None = None,
        max_retries: int = 3,
        retry_backoff: float = 1.0,
        timeout: int = 300,
        priority: int = 0,
        rate_limit: str | None = None,
        queue: str = "default",
        circuit_breaker: dict | None = None,
        retry_on: list[type[Exception]] | None = None,
        dont_retry_on: list[type[Exception]] | None = None,
        soft_timeout: float | None = None,
        middleware: list[TaskMiddleware] | None = None,
        retry_delays: list[float] | None = None,
        inject: list[str] | None = None,
        serializer: Serializer | None = None,
        max_retry_delay: int | None = None,
        max_concurrent: int | None = None,
    ) -> Callable[[Callable[..., Any]], TaskWrapper]:
        """Decorator to register a function as a background task.

        Args:
            name: Explicit task name. Defaults to ``module.qualname``.
            max_retries: Max retry attempts on failure before moving to DLQ.
            retry_backoff: Base delay in seconds for exponential backoff between retries.
            timeout: Max execution time in seconds before the task is killed.
            priority: Priority level (higher = more urgent).
            rate_limit: Rate limit string, e.g. ``"100/m"``, ``"10/s"``, ``"3600/h"``.
            queue: Named queue to submit to.
            circuit_breaker: Optional dict with ``threshold``, ``window`` (seconds),
                and ``cooldown`` (seconds) keys.
            retry_on: List of exception classes that should trigger retries.
                If set, only these exceptions are retried.
            dont_retry_on: List of exception classes that should never be retried.
            soft_timeout: Soft timeout in seconds. Checked via ``current_job.check_timeout()``.
            middleware: Per-task middleware instances (in addition to global middleware).
            inject: List of resource names to inject as keyword arguments.
            serializer: Per-task serializer. Falls back to the queue-level serializer.
            max_retry_delay: Maximum backoff delay in seconds. Defaults to 300
                (5 minutes) if not set.
            max_concurrent: Maximum number of concurrent running instances of
                this task. ``None`` means no limit.
        """

        def decorator(fn: Callable) -> TaskWrapper:
            task_name = name or f"{_resolve_module_name(fn.__module__)}.{fn.__qualname__}"

            # Detect Inject["name"] annotations (Phase E)
            from taskito.inject import _InjectAlias

            annotation_injects: list[str] = []
            try:
                import typing

                hints: dict[str, Any] = {}
                with contextlib.suppress(Exception):
                    # get_type_hints evaluates string annotations
                    ns = getattr(fn, "__globals__", {})
                    ns = {**ns, "Inject": __import__("taskito.inject", fromlist=["Inject"]).Inject}
                    hints = typing.get_type_hints(fn, globalns=ns, include_extras=True)
                # Fallback: check raw annotations if get_type_hints failed
                if not hints:
                    with contextlib.suppress(Exception):
                        hints = getattr(fn, "__annotations__", {})
                for _param_name, hint in hints.items():
                    if isinstance(hint, _InjectAlias):
                        annotation_injects.append(hint.resource_name)
            except Exception:
                pass

            # Merge explicit inject= with annotation-detected injects
            final_inject = list(inject or [])
            for res_name in annotation_injects:
                if res_name not in final_inject:
                    final_inject.append(res_name)

            # Store retry filters
            if retry_on or dont_retry_on:
                self._task_retry_filters[task_name] = {
                    "retry_on": retry_on or [],
                    "dont_retry_on": dont_retry_on or [],
                }

            # Store per-task middleware
            if middleware:
                self._task_middleware[task_name] = middleware

            # Store per-task serializer
            if serializer is not None:
                self._task_serializers[task_name] = serializer

            # Store inject map for resource injection
            if final_inject:
                self._task_inject_map[task_name] = final_inject

            # Wrap the function with hooks, middleware, and context
            wrapped = self._wrap_task(fn, task_name, soft_timeout)
            self._task_registry[task_name] = wrapped

            cb_threshold = None
            cb_window = None
            cb_cooldown = None
            cb_half_open_probes = None
            cb_half_open_success_rate = None
            if circuit_breaker:
                cb_threshold = circuit_breaker.get("threshold", 5)
                cb_window = circuit_breaker.get("window", 60)
                cb_cooldown = circuit_breaker.get("cooldown", 300)
                cb_half_open_probes = circuit_breaker.get("half_open_probes")
                cb_half_open_success_rate = circuit_breaker.get("half_open_success_rate")

            # Store config for worker startup
            config = PyTaskConfig(
                name=task_name,
                max_retries=max_retries,
                retry_backoff=retry_backoff,
                timeout=timeout,
                priority=priority,
                rate_limit=rate_limit,
                queue=queue,
                circuit_breaker_threshold=cb_threshold,
                circuit_breaker_window=cb_window,
                circuit_breaker_cooldown=cb_cooldown,
                retry_delays=retry_delays,
                max_retry_delay=max_retry_delay,
                max_concurrent=max_concurrent,
                circuit_breaker_half_open_probes=cb_half_open_probes,
                circuit_breaker_half_open_success_rate=cb_half_open_success_rate,
            )
            self._task_configs.append(config)

            # Return a TaskWrapper that has .delay() and .apply_async()
            wrapper = TaskWrapper(
                fn=fn,
                queue_ref=self,
                task_name=task_name,
                default_priority=priority,
                default_queue=queue,
                default_max_retries=max_retries,
                default_timeout=timeout,
                inject=final_inject or None,
            )

            # Preserve function metadata
            functools.update_wrapper(wrapper, fn)

            # Mark async status for native async dispatch
            is_async = asyncio.iscoroutinefunction(fn)
            wrapper._taskito_is_async = is_async
            if is_async:
                wrapper._taskito_async_fn = fn

            return wrapper

        return decorator

    def periodic(
        self,
        cron: str,
        name: str | None = None,
        args: tuple = (),
        kwargs: dict | None = None,
        queue: str = "default",
        timezone: str | None = None,
    ) -> Callable[[Callable[..., Any]], TaskWrapper]:
        """Decorator to register a periodic (cron-scheduled) task.

        Args:
            cron: Cron expression (6-field with seconds), e.g. ``"0 */5 * * * *"``
                for every 5 minutes.
            name: Explicit task name. Defaults to ``module.qualname``.
            args: Positional arguments to pass to the task on each run.
            kwargs: Keyword arguments to pass to the task on each run.
            queue: Named queue to submit to.
        """

        def decorator(fn: Callable) -> TaskWrapper:
            # Register as a normal task first
            wrapper = self.task(name=name, queue=queue)(fn)

            # Store periodic config for registration at worker startup
            payload = self._get_serializer(wrapper.name).dumps((args, kwargs or {}))
            self._periodic_configs.append(
                {
                    "name": name or f"{_resolve_module_name(fn.__module__)}.{fn.__qualname__}",
                    "task_name": wrapper.name,
                    "cron_expr": cron,
                    "payload": payload,
                    "queue": queue,
                    "timezone": timezone,
                }
            )

            return wrapper

        return decorator

    # -- Hooks / middleware --

    def before_task(self, fn: Callable) -> Callable:
        """Register a hook called before each task executes.

        Args:
            fn: Callback with signature ``fn(task_name, args, kwargs)``.
        """
        self._hooks["before_task"].append(fn)
        return fn

    def after_task(self, fn: Callable) -> Callable:
        """Register a hook called after each task completes or fails.

        Args:
            fn: Callback with signature
                ``fn(task_name, args, kwargs, result, error)``.
        """
        self._hooks["after_task"].append(fn)
        return fn

    def on_success(self, fn: Callable) -> Callable:
        """Register a hook called when a task completes successfully.

        Args:
            fn: Callback with signature
                ``fn(task_name, args, kwargs, result)``.
        """
        self._hooks["on_success"].append(fn)
        return fn

    def on_failure(self, fn: Callable) -> Callable:
        """Register a hook called when a task raises an exception.

        Args:
            fn: Callback with signature
                ``fn(task_name, args, kwargs, error)``.
        """
        self._hooks["on_failure"].append(fn)
        return fn

    # -- Worker Resources --

    def worker_resource(
        self,
        name: str,
        depends_on: list[str] | None = None,
        teardown: Callable | None = None,
        health_check: Callable | None = None,
        health_check_interval: float = 0.0,
        max_recreation_attempts: int = 3,
        scope: str = "worker",
        pool_size: int | None = None,
        pool_min: int = 0,
        acquire_timeout: float = 10.0,
        max_lifetime: float = 3600.0,
        idle_timeout: float = 300.0,
        reloadable: bool = False,
        frozen: bool = False,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Decorator to register a resource factory.

        Args:
            name: Resource name used in ``inject=["name"]``.
            depends_on: Names of resources this one depends on.
            teardown: Optional callable to clean up the resource on shutdown.
            health_check: Optional callable that returns truthy if healthy.
            health_check_interval: Seconds between health checks (0 = disabled).
            max_recreation_attempts: Max times to recreate on health failure.
            scope: Resource scope — ``"worker"``, ``"task"``, ``"thread"``,
                or ``"request"``.
            pool_size: Pool size for task-scoped resources.
            pool_min: Minimum pre-warmed instances (task scope).
            acquire_timeout: Max seconds to wait for pool instance.
            max_lifetime: Max seconds a pooled instance lives.
            idle_timeout: Max idle seconds before eviction.
            reloadable: Whether the resource can be hot-reloaded via SIGHUP.
            frozen: Wrap the resource in a read-only proxy.
        """
        from taskito.resources.graph import detect_cycle

        def decorator(factory: Callable[..., Any]) -> Callable[..., Any]:
            self.register_resource(
                ResourceDefinition(
                    name=name,
                    factory=factory,
                    depends_on=depends_on or [],
                    teardown=teardown,
                    health_check=health_check,
                    health_check_interval=health_check_interval,
                    max_recreation_attempts=max_recreation_attempts,
                    scope=ResourceScope(scope),
                    pool_size=pool_size,
                    pool_min=pool_min,
                    acquire_timeout=acquire_timeout,
                    max_lifetime=max_lifetime,
                    idle_timeout=idle_timeout,
                    reloadable=reloadable,
                    frozen=frozen,
                )
            )
            # Validate no cycles eagerly
            cycle = detect_cycle(self._resource_definitions)
            if cycle is not None:
                from taskito.exceptions import CircularDependencyError

                # Roll back the registration
                del self._resource_definitions[name]
                raise CircularDependencyError(
                    f"Circular dependency detected: {' -> '.join(cycle)}"
                )
            return factory

        return decorator

    def register_resource(self, definition: ResourceDefinition) -> None:
        """Programmatically register a resource definition.

        Args:
            definition: A :class:`~taskito.resources.ResourceDefinition`.
        """
        self._resource_definitions[definition.name] = definition

    def health_check(self, name: str) -> bool:
        """Run a resource's health check immediately.

        Args:
            name: The registered resource name.

        Returns:
            True if healthy, False otherwise.
        """
        runtime = self._resource_runtime
        if runtime is None:
            return False
        defn = self._resource_definitions.get(name)
        if defn is None or defn.health_check is None:
            return False
        try:
            instance = runtime.resolve(name)
            return bool(defn.health_check(instance))
        except Exception:
            return False

    def load_resources(self, toml_path: str) -> None:
        """Load resource definitions from a TOML file.

        Must be called before ``run_worker()``.

        Args:
            toml_path: Path to the TOML configuration file.
        """
        from taskito.resources.toml_config import load_resources_from_toml

        for defn in load_resources_from_toml(toml_path):
            self.register_resource(defn)

    def proxy_stats(self) -> list[dict[str, Any]]:
        """Return per-handler proxy reconstruction metrics."""
        return self._proxy_metrics.to_list()

    def interception_stats(self) -> dict[str, Any]:
        """Return interception performance metrics."""
        if self._interception_metrics is not None:
            return self._interception_metrics.to_dict()
        return {}

    def register_type(
        self,
        python_type: type,
        strategy: str,
        *,
        resource: str | None = None,
        message: str | None = None,
        converter: Callable | None = None,
        type_key: str | None = None,
        proxy_handler: str | None = None,
    ) -> None:
        """Register a custom type with the interception system.

        Args:
            python_type: The type to register.
            strategy: One of ``"pass"``, ``"convert"``, ``"redirect"``,
                ``"reject"``, or ``"proxy"``.
            resource: Resource name for ``"redirect"`` strategy.
            message: Rejection reason for ``"reject"`` strategy.
            converter: Converter callable for ``"convert"`` strategy.
            type_key: Key for the converter reconstructor dispatch.
            proxy_handler: Handler name for ``"proxy"`` strategy.
        """
        if self._interceptor is None:
            raise RuntimeError(
                "Interception is disabled; set interception='strict' or "
                "'lenient' to use register_type()"
            )
        from taskito.interception.strategy import Strategy as S

        strat = S(strategy)
        self._interceptor._registry.register(
            python_type,
            strat,
            priority=15,
            redirect_resource=resource,
            reject_reason=message,
            converter=converter,
            type_key=type_key,
            proxy_handler=proxy_handler,
        )

    def set_queue_rate_limit(self, queue_name: str, rate_limit: str) -> None:
        """Set a rate limit for an entire queue.

        Args:
            queue_name: Queue name (e.g. ``"default"``).
            rate_limit: Rate limit string, e.g. ``"100/m"``, ``"10/s"``.
        """
        self._queue_configs.setdefault(queue_name, {})["rate_limit"] = rate_limit

    def set_queue_concurrency(self, queue_name: str, max_concurrent: int) -> None:
        """Set a maximum number of concurrent jobs for a queue.

        Args:
            queue_name: Queue name (e.g. ``"default"``).
            max_concurrent: Maximum number of jobs running simultaneously
                from this queue.
        """
        self._queue_configs.setdefault(queue_name, {})["max_concurrent"] = max_concurrent

    def _get_serializer(self, task_name: str) -> Serializer:
        """Get the serializer for a task (per-task or queue-level fallback)."""
        return self._task_serializers.get(task_name, self._serializer)

    def _deserialize_payload(self, task_name: str, payload: bytes) -> tuple:
        """Deserialize a job payload using the per-task or queue-level serializer."""
        return self._get_serializer(task_name).loads(payload)  # type: ignore[no-any-return]

    def _get_middleware_chain(self, task_name: str) -> list[TaskMiddleware]:
        """Get the combined global + per-task middleware list."""
        per_task = self._task_middleware.get(task_name, [])
        return self._global_middleware + per_task

    def _wrap_task(
        self, fn: Callable, task_name: str, soft_timeout: float | None = None
    ) -> Callable:
        """Wrap a task function with hooks, middleware, and job context."""
        from taskito.context import _clear_context, current_job
        from taskito.interception.reconstruct import reconstruct_args

        hooks = self._hooks
        queue_ref = self

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            # Reconstruct intercepted arguments (CONVERT markers → original types)
            redirects: dict[str, str] = {}
            if queue_ref._interceptor is not None:
                args, kwargs, redirects = reconstruct_args(args, kwargs)

            # Reconstruct proxy markers (PROXY → live objects)
            proxy_cleanup: list[Any] = []
            if queue_ref._proxy_registry is not None and not queue_ref._test_mode_active:
                args, kwargs, proxy_cleanup = reconstruct_proxies(
                    args,
                    kwargs,
                    queue_ref._proxy_registry,
                    signing_secret=queue_ref._recipe_signing_key,
                    max_timeout=queue_ref._max_reconstruction_timeout,
                    metrics=queue_ref._proxy_metrics,
                )

            # Inject resources from runtime
            release_callbacks: list[Any] = []
            runtime = queue_ref._resource_runtime
            if runtime is not None:
                # From explicit inject=["db"] on task decorator
                for res_name in queue_ref._task_inject_map.get(task_name, []):
                    if res_name not in kwargs:
                        instance, release = runtime.acquire_for_task(res_name)
                        kwargs[res_name] = instance
                        if release is not None:
                            release_callbacks.append(release)
                # From interception REDIRECT markers
                for kwarg_name, resource_name in redirects.items():
                    instance, release = runtime.acquire_for_task(resource_name)
                    kwargs[kwarg_name] = instance
                    if release is not None:
                        release_callbacks.append(release)

            middleware_chain = queue_ref._get_middleware_chain(task_name)

            # Set soft timeout on context if configured
            if soft_timeout is not None:
                current_job._set_soft_timeout(soft_timeout)

            # Run middleware before hooks
            completed_mw: list[Any] = []
            for mw in middleware_chain:
                try:
                    mw.before(current_job)
                    completed_mw.append(mw)
                except Exception:
                    logger.exception("middleware before() error")

            for hook in hooks["before_task"]:
                hook(task_name, args, kwargs)

            error = None
            result = None
            try:
                ret = run_maybe_async(fn(*args, **kwargs))
                result = ret
            except Exception as exc:
                error = exc
                for hook in hooks["on_failure"]:
                    hook(task_name, args, kwargs, exc)
                raise
            else:
                for hook in hooks["on_success"]:
                    hook(task_name, args, kwargs, result)
                return result
            finally:
                # Release task/request-scoped resources
                for release_fn in release_callbacks:
                    try:
                        release_fn()
                    except Exception:
                        logger.exception("resource release error")
                # Clean up reconstructed proxies (LIFO order)
                cleanup_proxies(proxy_cleanup, metrics=queue_ref._proxy_metrics)
                for hook in hooks["after_task"]:
                    hook(task_name, args, kwargs, result, error)
                # Run middleware after hooks (only those whose before() succeeded)
                for mw in completed_mw:
                    try:
                        mw.after(current_job, result, error)
                    except Exception:
                        logger.exception("middleware after() error")
                # Emit job lifecycle events
                event_payload = {
                    "task_name": task_name,
                    "job_id": current_job.id,
                    "queue": current_job.queue_name,
                }
                if error is not None:
                    event_payload["error"] = str(error)
                    queue_ref._emit_event(EventType.JOB_FAILED, event_payload)
                else:
                    queue_ref._emit_event(EventType.JOB_COMPLETED, event_payload)
                _clear_context()

        return wrapper

    def enqueue(
        self,
        task_name: str,
        args: tuple = (),
        kwargs: dict | None = None,
        priority: int | None = None,
        delay: float | None = None,
        queue: str | None = None,
        max_retries: int | None = None,
        timeout: int | None = None,
        unique_key: str | None = None,
        metadata: str | None = None,
        depends_on: str | list[str] | None = None,
        expires: float | None = None,
        result_ttl: int | None = None,
    ) -> JobResult:
        """Enqueue a task for background execution.

        Args:
            task_name: Registered task name.
            args: Positional arguments to pass to the task function.
            kwargs: Keyword arguments to pass to the task function.
            priority: Job priority (higher = more urgent).
            delay: Delay in seconds before the job becomes eligible to run.
            queue: Target queue name.
            max_retries: Max retry attempts.
            timeout: Timeout in seconds.
            unique_key: Deduplication key.
            metadata: Arbitrary JSON string to attach to the job.
            depends_on: Job ID or list of job IDs that must complete first.
            expires: Seconds until the job expires (skipped if not started by then).
            result_ttl: Per-job result TTL in seconds. Overrides global result_ttl.
        """
        final_args = args
        final_kwargs = kwargs or {}

        # Run on_enqueue middleware hook (options dict is mutable)
        enqueue_options: dict[str, Any] = {
            "priority": priority,
            "delay": delay,
            "queue": queue,
            "max_retries": max_retries,
            "timeout": timeout,
            "unique_key": unique_key,
            "metadata": metadata,
            "depends_on": depends_on,
            "expires": expires,
            "result_ttl": result_ttl,
        }
        for mw in self._global_middleware:
            try:
                mw.on_enqueue(task_name, final_args, final_kwargs, enqueue_options)
            except Exception:
                logger.exception("middleware on_enqueue() error")

        # Apply any middleware mutations back
        priority = enqueue_options.get("priority")
        delay = enqueue_options.get("delay")
        queue = enqueue_options.get("queue")
        max_retries = enqueue_options.get("max_retries")
        timeout = enqueue_options.get("timeout")
        unique_key = enqueue_options.get("unique_key")
        metadata = enqueue_options.get("metadata")
        depends_on = enqueue_options.get("depends_on")
        expires = enqueue_options.get("expires")
        result_ttl = enqueue_options.get("result_ttl")

        if self._interceptor is not None and not self._test_mode_active:
            final_args, final_kwargs = self._interceptor.intercept(final_args, final_kwargs)
        task_serializer = self._get_serializer(task_name)
        payload = task_serializer.dumps((final_args, final_kwargs))

        dep_ids = None
        if depends_on is not None:
            dep_ids = [depends_on] if isinstance(depends_on, str) else list(depends_on)

        py_job = self._inner.enqueue(
            task_name=task_name,
            payload=payload,
            queue=queue or "default",
            priority=priority,
            delay_seconds=delay,
            max_retries=max_retries,
            timeout=timeout,
            unique_key=unique_key,
            metadata=metadata,
            depends_on=dep_ids,
            expires=expires,
            result_ttl=result_ttl,
        )

        self._emit_event(
            EventType.JOB_ENQUEUED,
            {
                "task_name": task_name,
                "job_id": py_job.id,
                "queue": queue or "default",
            },
        )

        return JobResult(py_job=py_job, queue=self)

    def enqueue_many(
        self,
        task_name: str,
        args_list: list[tuple],
        kwargs_list: list[dict] | None = None,
        priority: int | None = None,
        queue: str | None = None,
        max_retries: int | None = None,
        timeout: int | None = None,
        delay: float | None = None,
        delay_list: list[float | None] | None = None,
        unique_keys: list[str | None] | None = None,
        metadata: str | None = None,
        metadata_list: list[str | None] | None = None,
        expires: float | None = None,
        expires_list: list[float | None] | None = None,
        result_ttl: int | None = None,
        result_ttl_list: list[int | None] | None = None,
    ) -> list[JobResult]:
        """Enqueue multiple jobs for the same task in a single transaction.

        Args:
            task_name: The registered task name.
            args_list: List of positional argument tuples, one per job.
            kwargs_list: Optional list of kwarg dicts, one per job.
            priority: Priority for all jobs (uses default if None).
            queue: Queue name for all jobs (uses "default" if None).
            max_retries: Max retries for all jobs (uses default if None).
            timeout: Timeout in seconds for all jobs (uses default if None).
            delay: Uniform delay in seconds for all jobs.
            delay_list: Per-job delays in seconds.
            unique_keys: Per-job deduplication keys.
            metadata: Uniform metadata JSON string for all jobs.
            metadata_list: Per-job metadata JSON strings.
            expires: Uniform expiry in seconds for all jobs.
            expires_list: Per-job expiry in seconds.
            result_ttl: Uniform result TTL in seconds for all jobs.
            result_ttl_list: Per-job result TTL in seconds.

        Returns:
            List of JobResult handles, one per enqueued job.
        """
        count = len(args_list)
        if kwargs_list is not None and len(kwargs_list) != len(args_list):
            raise ValueError(
                f"kwargs_list length ({len(kwargs_list)}) must match "
                f"args_list length ({len(args_list)})"
            )
        kw_list = kwargs_list or [{}] * count
        task_serializer = self._get_serializer(task_name)
        if self._interceptor is not None:
            pairs = [
                self._interceptor.intercept(a, kw)
                for a, kw in zip(args_list, kw_list, strict=True)
            ]
            payloads = [task_serializer.dumps((a, kw)) for a, kw in pairs]
        else:
            payloads = [
                task_serializer.dumps((a, kw)) for a, kw in zip(args_list, kw_list, strict=True)
            ]
        task_names = [task_name] * count

        queues_list = [queue or "default"] * count if queue else None
        priorities_list = [priority] * count if priority is not None else None
        retries_list = [max_retries] * count if max_retries is not None else None
        timeouts_list = [timeout] * count if timeout is not None else None

        # Build per-job optional lists
        delays = delay_list or ([delay] * count if delay is not None else None)
        metas = metadata_list or ([metadata] * count if metadata is not None else None)
        exp_list = expires_list or ([expires] * count if expires is not None else None)
        ttl_list = result_ttl_list or ([result_ttl] * count if result_ttl is not None else None)

        py_jobs = self._inner.enqueue_batch(
            task_names=task_names,
            payloads=payloads,
            queues=queues_list,
            priorities=priorities_list,
            max_retries_list=retries_list,
            timeouts=timeouts_list,
            delay_seconds_list=delays,
            unique_keys=unique_keys,
            metadata_list=metas,
            expires_list=exp_list,
            result_ttl_list=ttl_list,
        )

        results = [JobResult(py_job=pj, queue=self) for pj in py_jobs]

        # Emit events and dispatch on_enqueue middleware
        for job_result in results:
            self._emit_event(
                EventType.JOB_ENQUEUED,
                {"job_id": job_result.id, "task_name": task_name},
            )
            for mw in self._get_middleware_chain(task_name):
                try:
                    options: dict[str, Any] = {}
                    mw.on_enqueue(task_name, args_list[0], {}, options)
                except Exception:
                    pass

        return results

    # -- Events & Webhooks --

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

    # -- Worker startup --

    def _print_banner(self, queues: list[str]) -> None:
        """Print ASCII startup banner."""
        from taskito import __version__

        banner = rf"""
 _            _    _ _
| |_ __ _ ___| | _(_) |_ ___
| __/ _` / __| |/ / | __/ _ \
| || (_| \__ \   <| | || (_) |
 \__\__,_|___/_|\_\_|\__\___/  v{__version__}
"""
        lines = [banner]
        lines.append(f"> Backend:     {self._backend}")
        if self._backend == "sqlite":
            lines.append(f"> DB:          {self._db_path}")
        else:
            # Mask password in connection URL for display
            url = self._db_url or ""
            parsed_url = urllib.parse.urlparse(url)
            if parsed_url.password:
                masked = parsed_url._replace(
                    netloc=f"{parsed_url.username}:****@{parsed_url.hostname}"
                    + (f":{parsed_url.port}" if parsed_url.port else "")
                )
                url = urllib.parse.urlunparse(masked)
            lines.append(f"> DB:          {url}")
            lines.append(f"> Schema:      {self._schema}")
        lines.append(f"> Concurrency: {self._workers} (threads)")
        lines.append(f"> Queues:      {', '.join(queues)}")
        lines.append("")

        task_names = sorted(self._task_registry.keys())
        if task_names:
            lines.append("[tasks]")
            for name in task_names:
                lines.append(f"  . {name}")
            lines.append("")

        if self._periodic_configs:
            lines.append("[periodic]")
            for pc in self._periodic_configs:
                lines.append(f"  . {pc['name']}  ({pc['cron_expr']})")
            lines.append("")

        if self._resource_definitions:
            lines.append("[resources]")
            for rname, rdef in sorted(self._resource_definitions.items()):
                deps = f" (depends: {', '.join(rdef.depends_on)})" if rdef.depends_on else ""
                lines.append(f"  . {rname}{deps}")
            lines.append("")

        print("\n".join(lines))

    def run_worker(
        self,
        queues: Sequence[str] | None = None,
        tags: list[str] | None = None,
        pool: str = "thread",
        app: str | None = None,
    ) -> None:
        """Start the worker loop. Blocks until interrupted.

        Args:
            queues: List of queue names to consume from. ``None`` consumes
                from all queues.
            tags: Optional tags for worker specialization / routing.
            pool: Worker pool type — ``"thread"`` (default) or ``"prefork"``.
                Prefork spawns child processes with independent GILs for
                true parallelism on CPU-bound tasks.
            app: Import path to the Queue instance (e.g. ``"myapp:queue"``).
                Required when ``pool="prefork"``.
        """
        if pool == "prefork" and not app:
            raise ValueError("app= is required when pool='prefork' (e.g. app='myapp:queue')")
        queue_list = list(queues) if queues else None

        # Make queue accessible from job context (for current_job.update_progress())
        from taskito.context import _set_queue_ref

        _set_queue_ref(self)

        # Register periodic tasks with Rust scheduler
        for pc in self._periodic_configs:
            self._inner.register_periodic(
                name=pc["name"],
                task_name=pc["task_name"],
                cron_expr=pc["cron_expr"],
                args=pc["payload"],
                queue=pc["queue"],
                timezone=pc.get("timezone"),
            )

        if not logging.root.handlers:
            logging.basicConfig(
                level=logging.INFO,
                format="[%(asctime)s] %(levelname)s %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )

        worker_queues = queue_list or ["default"]
        self._print_banner(worker_queues)

        # Initialize worker resources (before Rust dispatches tasks)
        health_checker = None
        if self._resource_definitions:
            from taskito.resources.health import HealthChecker

            self._resource_runtime = ResourceRuntime(self._resource_definitions)
            self._resource_runtime.initialize()
            logger.info(
                "Initialized %d resource(s): %s",
                len(self._resource_definitions),
                ", ".join(self._resource_runtime._init_order),
            )
            health_checker = HealthChecker(self._resource_runtime)
            health_checker.start()

        # Set up signal handlers for graceful shutdown (only in main thread)
        is_main = threading.current_thread() is threading.main_thread()
        original_sigint = None
        original_sigterm = None

        if is_main:
            original_sigint = signal.getsignal(signal.SIGINT)
            original_sigterm = signal.getsignal(signal.SIGTERM)

            def shutdown_handler(signum: int, frame: Any) -> None:
                logger.info("Warm shutdown (waiting for running tasks to finish)...")
                with contextlib.suppress(Exception):
                    self._inner.set_worker_status(worker_id, "draining")
                self._inner.request_shutdown()
                # Restore original handlers so a second signal force-kills
                signal.signal(signal.SIGINT, original_sigint)
                signal.signal(signal.SIGTERM, original_sigterm)

            signal.signal(signal.SIGINT, shutdown_handler)
            signal.signal(signal.SIGTERM, shutdown_handler)

            # SIGHUP handler for hot-reloading resources (Unix only)
            if hasattr(signal, "SIGHUP"):

                def sighup_handler(signum: int, frame: Any) -> None:
                    logger.info("SIGHUP received — reloading reloadable resources")
                    if self._resource_runtime is not None:
                        results = self._resource_runtime.reload()
                        for rname, success in results.items():
                            logger.info(
                                "Reload %s: %s",
                                rname,
                                "OK" if success else "FAILED",
                            )

                signal.signal(signal.SIGHUP, sighup_handler)

        # Serialize resource names for worker advertisement
        resources_json: str | None = None
        if self._resource_definitions:
            resources_json = json.dumps(sorted(self._resource_definitions.keys()))

        # Generate worker ID and start Python-side heartbeat thread
        worker_id = str(uuid.uuid4())
        stop_heartbeat = threading.Event()
        heartbeat_thread = threading.Thread(
            target=self._run_heartbeat,
            args=(worker_id, stop_heartbeat),
            daemon=True,
            name="taskito-heartbeat",
        )
        heartbeat_thread.start()

        self._emit_event(
            EventType.WORKER_STARTED,
            {"worker_id": worker_id, "queues": worker_queues},
        )
        self._emit_event(
            EventType.WORKER_ONLINE,
            {"worker_id": worker_id, "queues": worker_queues, "pool": pool},
        )

        try:
            queue_configs_json = json.dumps(self._queue_configs) if self._queue_configs else None
            self._inner.run_worker(
                task_registry=self._task_registry,
                task_configs=self._task_configs,
                queues=queue_list,
                drain_timeout_secs=self._drain_timeout,
                tags=",".join(tags) if tags else None,
                worker_id=worker_id,
                resources=resources_json,
                threads=self._workers,
                async_concurrency=self._async_concurrency,
                queue_configs=queue_configs_json,
                pool=pool if pool != "thread" else None,
                app_path=app,
            )
        except KeyboardInterrupt:
            logger.info("Cold shutdown (terminating immediately)")
        finally:
            self._emit_event(
                EventType.WORKER_STOPPED,
                {"worker_id": worker_id},
            )
            stop_heartbeat.set()
            heartbeat_thread.join(timeout=6)
            # Tear down resources before stopping async loop
            if health_checker is not None:
                health_checker.stop()
            if self._resource_runtime is not None:
                self._resource_runtime.teardown()
                self._resource_runtime = None
            logger.info("Worker stopped.")
            if is_main:
                if original_sigint is not None:
                    signal.signal(signal.SIGINT, original_sigint)
                if original_sigterm is not None:
                    signal.signal(signal.SIGTERM, original_sigterm)

    def _build_resource_health_json(self) -> str | None:
        """Snapshot current resource health as JSON for heartbeat."""
        if not self._resource_definitions:
            return None
        runtime = self._resource_runtime
        health: dict[str, str] = {}
        for name in self._resource_definitions:
            if runtime is not None and name in runtime._unhealthy:
                health[name] = "unhealthy"
            else:
                health[name] = "healthy"
        return json.dumps(health)

    def _run_heartbeat(
        self,
        worker_id: str,
        stop_event: threading.Event,
    ) -> None:
        """Send periodic heartbeats to storage with current resource health."""
        prev_unhealthy: set[str] = set()
        while not stop_event.is_set():
            resource_health = self._build_resource_health_json()
            try:
                reaped_ids = self._inner.worker_heartbeat(worker_id, resource_health)
                # Emit WORKER_OFFLINE events for reaped dead workers
                for rid in reaped_ids:
                    self._emit_event(EventType.WORKER_OFFLINE, {"worker_id": rid})
            except Exception:
                logger.debug("Heartbeat failed", exc_info=True)

            # Detect health transitions → emit WORKER_UNHEALTHY
            runtime = self._resource_runtime
            if runtime is not None:
                current_unhealthy = set(runtime._unhealthy)
                new_unhealthy = current_unhealthy - prev_unhealthy
                if new_unhealthy:
                    self._emit_event(
                        EventType.WORKER_UNHEALTHY,
                        {
                            "worker_id": worker_id,
                            "resources": sorted(new_unhealthy),
                        },
                    )
                prev_unhealthy = current_unhealthy

            stop_event.wait(timeout=5.0)

    # -- Resource Status --

    def resource_status(self) -> list[dict[str, Any]]:
        """Return per-resource status info.

        Each entry contains: name, scope, health, init_duration_ms,
        recreations, depends_on.  Returns an empty list if no resources
        are registered or the runtime is not initialized.
        """
        if self._resource_runtime is not None:
            return self._resource_runtime.status()
        # Runtime not initialized — return definitions with unknown health
        result: list[dict[str, Any]] = []
        for name, defn in self._resource_definitions.items():
            result.append(
                {
                    "name": name,
                    "scope": defn.scope.value,
                    "health": "not_initialized",
                    "init_duration_ms": 0,
                    "recreations": 0,
                    "depends_on": defn.depends_on,
                }
            )
        return result

    # -- Test Mode --

    def test_mode(
        self,
        propagate_errors: bool = False,
        resources: dict[str, Any] | None = None,
    ) -> TestMode:
        """Return a context manager that runs tasks synchronously (no worker needed).

        Args:
            propagate_errors: If True, re-raise task exceptions immediately.
            resources: Dict of resource name → mock instance for injection
                during test mode.

        Returns:
            A :class:`~taskito.testing.TestMode` context manager.
        """
        from taskito.testing import TestMode

        return TestMode(self, propagate_errors=propagate_errors, resources=resources)
