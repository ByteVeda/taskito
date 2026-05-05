"""Main Queue class.

The Queue class is composed from multiple mixins for organization. Methods
shared across the inspection, operations, lock, decorator, resource, event,
and lifecycle surfaces live in the corresponding mixin under
``taskito.mixins.*``. Async wrappers come from ``taskito.async_support.mixins``.

The Queue class itself (this file) handles only:
- Constructor and storage backend initialization
- enqueue() / enqueue_many() job submission
- _wrap_task() task body wrapping with hooks, middleware, proxies, resources
- Internal helpers (``_get_serializer``, ``_deserialize_payload``,
  ``_get_middleware_chain``)
"""

from __future__ import annotations

import functools
import logging
import os
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any

from taskito._taskito import PyQueue
from taskito.async_support.helpers import run_maybe_async
from taskito.async_support.mixins import AsyncQueueMixin
from taskito.context import _clear_context, current_job
from taskito.events import EventBus, EventType
from taskito.interception import ArgumentInterceptor
from taskito.interception.built_in import build_default_registry
from taskito.interception.metrics import InterceptionMetrics
from taskito.interception.reconstruct import reconstruct_args
from taskito.middleware import TaskMiddleware
from taskito.mixins import (
    QueueDecoratorMixin,
    QueueEventsMixin,
    QueueInspectionMixin,
    QueueLifecycleMixin,
    QueueLockMixin,
    QueueOperationsMixin,
    QueueResourceMixin,
    QueueSettingsMixin,
)
from taskito.proxies import ProxyRegistry, cleanup_proxies, reconstruct_proxies
from taskito.proxies.built_in import register_builtin_handlers
from taskito.proxies.metrics import ProxyMetrics
from taskito.result import JobResult
from taskito.serializers import CloudpickleSerializer, Serializer
from taskito.webhooks import WebhookManager

if TYPE_CHECKING:
    from taskito._taskito import PyTaskConfig
    from taskito.resources.definition import ResourceDefinition
    from taskito.resources.runtime import ResourceRuntime

try:
    from taskito.workflows.mixins import QueueWorkflowMixin
    from taskito.workflows.tracker import WorkflowTracker

    _WORKFLOWS_AVAILABLE = True
except ImportError:  # pragma: no cover - workflows feature not compiled in

    class QueueWorkflowMixin:  # type: ignore[no-redef]
        pass

    WorkflowTracker = None  # type: ignore[assignment,misc]
    _WORKFLOWS_AVAILABLE = False

logger = logging.getLogger("taskito")


class Queue(
    QueueDecoratorMixin,
    QueueResourceMixin,
    QueueEventsMixin,
    QueueLifecycleMixin,
    QueueInspectionMixin,
    QueueOperationsMixin,
    QueueLockMixin,
    QueueSettingsMixin,
    QueueWorkflowMixin,
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
        self._interception_metrics: InterceptionMetrics | None = None
        if interception != "off":
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

        # Workflow support
        self._workflow_registry: dict[str, Any] = {}
        self._workflow_tracker: Any = None
        if _WORKFLOWS_AVAILABLE and hasattr(self._inner, "submit_workflow"):
            self._workflow_tracker = WorkflowTracker(self)

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

        # Build a per-job options dict so on_enqueue middleware can mutate
        # priority/queue/delay/etc. on a per-job basis before the batch is
        # committed. The dispatch must happen BEFORE enqueue_batch — running
        # it after (as the previous implementation did) made mutations
        # impossible to apply.
        per_job_options: list[dict[str, Any]] = [
            {
                "priority": priority,
                "queue": queue,
                "max_retries": max_retries,
                "timeout": timeout,
                "delay": (delay_list[i] if delay_list is not None else delay),
                "unique_key": (unique_keys[i] if unique_keys is not None else None),
                "metadata": (metadata_list[i] if metadata_list is not None else metadata),
                "expires": (expires_list[i] if expires_list is not None else expires),
                "result_ttl": (result_ttl_list[i] if result_ttl_list is not None else result_ttl),
            }
            for i in range(count)
        ]

        chain = self._get_middleware_chain(task_name)
        for i in range(count):
            for mw in chain:
                try:
                    mw.on_enqueue(task_name, args_list[i], kw_list[i], per_job_options[i])
                except Exception:
                    logger.exception("middleware on_enqueue() error")

        # Read mutated per-job options back into the per-job lists passed to
        # the Rust batch enqueue. `None` entries are forwarded so the Rust
        # side falls back to its defaults.
        queues_list = [opt["queue"] or "default" for opt in per_job_options]
        priorities_list = [opt["priority"] for opt in per_job_options]
        retries_list = [opt["max_retries"] for opt in per_job_options]
        timeouts_list = [opt["timeout"] for opt in per_job_options]
        delays = [opt["delay"] for opt in per_job_options]
        per_job_unique_keys = [opt["unique_key"] for opt in per_job_options]
        metas = [opt["metadata"] for opt in per_job_options]
        exp_list = [opt["expires"] for opt in per_job_options]
        ttl_list = [opt["result_ttl"] for opt in per_job_options]

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

        py_jobs = self._inner.enqueue_batch(
            task_names=task_names,
            payloads=payloads,
            queues=queues_list,
            priorities=priorities_list,
            max_retries_list=retries_list,
            timeouts=timeouts_list,
            delay_seconds_list=delays,
            unique_keys=per_job_unique_keys,
            metadata_list=metas,
            expires_list=exp_list,
            result_ttl_list=ttl_list,
        )

        results = [JobResult(py_job=pj, queue=self) for pj in py_jobs]

        for job_result in results:
            self._emit_event(
                EventType.JOB_ENQUEUED,
                {"job_id": job_result.id, "task_name": task_name},
            )

        return results
