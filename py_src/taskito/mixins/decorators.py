"""Task and periodic decorators, lifecycle hooks, and registration."""

from __future__ import annotations

import contextlib
import functools
import inspect
import logging
import os
import sys
import typing
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from taskito._taskito import PyTaskConfig
from taskito.async_support.helpers import run_maybe_async
from taskito.context import _clear_context, current_job
from taskito.events import EventType
from taskito.inject import Inject, _InjectAlias
from taskito.interception.reconstruct import reconstruct_args
from taskito.predicates.core import coerce_predicate
from taskito.proxies import cleanup_proxies, reconstruct_proxies
from taskito.task import TaskWrapper

if TYPE_CHECKING:
    from taskito.interception import ArgumentInterceptor
    from taskito.middleware import TaskMiddleware
    from taskito.predicates import Predicate
    from taskito.predicates.metrics import PredicateMetrics
    from taskito.proxies import ProxyRegistry
    from taskito.proxies.metrics import ProxyMetrics
    from taskito.resources.runtime import ResourceRuntime
    from taskito.serializers import Serializer


logger = logging.getLogger("taskito")


def _resolve_module_name(module_name: str) -> str:
    """Resolve __main__ to the actual module name."""
    if module_name != "__main__":
        return module_name

    main = sys.modules.get("__main__")
    if main is not None:
        spec = getattr(main, "__spec__", None)
        if spec and spec.name:
            return str(spec.name)
        f = getattr(main, "__file__", None)
        if f:
            return str(os.path.splitext(os.path.basename(f))[0])
    return module_name


class QueueDecoratorMixin:
    """Task/periodic decorators, hooks, type registration, queue-level config."""

    _task_registry: dict[str, Callable]
    _task_configs: list[PyTaskConfig]
    _periodic_configs: list[dict[str, Any]]
    _hooks: dict[str, list[Callable]]
    _task_serializers: dict[str, Serializer]
    _task_idempotent: dict[str, bool]
    _task_middleware: dict[str, list[TaskMiddleware]]
    _task_retry_filters: dict[str, dict[str, list[type[Exception]]]]
    _task_inject_map: dict[str, list[str]]
    _task_predicates: dict[str, Predicate]
    _task_predicate_on_false: dict[str, str]
    _task_predicate_extras: dict[str, dict[str, Any]]
    _task_default_defer: dict[str, float]
    _task_predicate_serialized: dict[str, dict[str, Any] | None]
    _predicate_metrics: PredicateMetrics
    _interceptor: ArgumentInterceptor | None
    _proxy_registry: ProxyRegistry | None
    _proxy_metrics: ProxyMetrics
    _resource_runtime: ResourceRuntime | None
    _test_mode_active: bool
    _recipe_signing_key: str | None
    _max_reconstruction_timeout: int
    _global_middleware: list[TaskMiddleware]
    _queue_configs: dict[str, dict[str, Any]]

    # ``_emit_event`` is provided by ``QueueEventsMixin`` on the composed
    # Queue. Declaring it as a class-level callable attribute (not a method)
    # lets mypy see it from this mixin without overriding the real
    # implementation through MRO.
    _emit_event: Callable[..., None]
    # ``_apply_dispatch_predicate`` is defined on the Queue itself
    # (alongside enqueue) since it needs ``_inner`` and the task
    # serializer. Declared here so mypy sees it through the mixin.
    _apply_dispatch_predicate: Callable[..., None]

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
            # Worker-dispatch predicate gate. Evaluated on the raw
            # deserialized payload (before arg/proxy reconstruction) so
            # re-enqueue on defer can round-trip cleanly.
            if task_name in queue_ref._task_predicates:
                queue_ref._apply_dispatch_predicate(
                    task_name=task_name,
                    args=args,
                    kwargs=kwargs,
                    job_id=current_job.id,
                    queue_name=current_job.queue_name,
                    retry_count=current_job.retry_count,
                )

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

            # Run middleware before hooks (skipping middlewares whose
            # predicate filter excludes this job)
            completed_mw: list[Any] = []
            for mw in middleware_chain:
                if not mw._should_apply(current_job):
                    continue
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
                event_payload: dict[str, Any] = {
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
        idempotent: bool = False,
        predicate: Predicate | Callable[..., Any] | None = None,
        on_false: str = "defer",
        predicate_extras: dict[str, Any] | None = None,
        default_defer_seconds: float = 60.0,
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
            idempotent: When ``True``, ``.delay()``/``.apply_async()`` calls
                automatically derive a deduplication key from
                ``sha256(task_name|serialized_payload)``. Two calls with
                identical arguments while a job is pending or running return
                the same job ID instead of producing a duplicate. The slot is
                released once the job leaves the active state. Per-call
                ``idempotency_key="..."`` overrides the derived key; per-call
                ``idempotent=False`` disables auto-derivation for that one
                submission.
            predicate: A :class:`~taskito.predicates.Predicate` (or plain
                callable receiving a :class:`~taskito.predicates.PredicateContext`)
                evaluated both at enqueue time and at worker-dispatch time
                to decide whether the job runs.
            on_false: What to do when the predicate returns ``False`` —
                ``"defer"`` (re-schedule with ``default_defer_seconds``),
                ``"cancel"`` (terminally skip).
            predicate_extras: Arbitrary dict forwarded to the predicate via
                ``PredicateContext.extras``. Useful for passing static
                config without re-instantiating the predicate.
            default_defer_seconds: Default delay when ``on_false="defer"``
                and the predicate returns plain ``False`` (no explicit
                ``Defer(seconds=...)``). Ignored otherwise.
        """
        if on_false not in {"defer", "cancel"}:
            raise ValueError(f"on_false must be 'defer' or 'cancel', got {on_false!r}")
        if default_defer_seconds < 0:
            raise ValueError("default_defer_seconds must be >= 0")

        def decorator(fn: Callable) -> TaskWrapper:
            task_name = name or f"{_resolve_module_name(fn.__module__)}.{fn.__qualname__}"

            # Detect Inject["name"] annotations (Phase E)
            annotation_injects: list[str] = []
            try:
                hints: dict[str, Any] = {}
                with contextlib.suppress(Exception):
                    # get_type_hints evaluates string annotations
                    ns = getattr(fn, "__globals__", {})
                    ns = {**ns, "Inject": Inject}
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

            # Store per-task idempotency flag (auto-derives unique_key on enqueue)
            if idempotent:
                self._task_idempotent[task_name] = True

            # Store predicate (and its on_false/extras/default_defer).
            # Also serialize a JSON snapshot so the inspection API and
            # dashboard can show "gated by: ..." without keeping a live
            # Python reference. Bare callables can't be serialized; the
            # snapshot is None in that case.
            if predicate is not None:
                coerced = coerce_predicate(predicate)
                if coerced is not None:
                    self._task_predicates[task_name] = coerced
                    self._task_predicate_on_false[task_name] = on_false
                    if predicate_extras:
                        self._task_predicate_extras[task_name] = dict(predicate_extras)
                    self._task_default_defer[task_name] = default_defer_seconds
                    try:
                        self._task_predicate_serialized[task_name] = coerced.to_dict()
                    except Exception:
                        self._task_predicate_serialized[task_name] = None

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
                queue_ref=self,  # type: ignore[arg-type]
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
            is_async = inspect.iscoroutinefunction(fn)
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
            # If fn is a WorkflowProxy (from @queue.workflow()), create a
            # launcher task that submits the workflow on each cron trigger.
            if getattr(fn, "_is_workflow_proxy", False):
                proxy: Any = fn
                launcher_name = f"_wf_launcher_{proxy._name}"

                @self.task(name=launcher_name, queue=queue)
                def _wf_launcher() -> str:
                    run = proxy.submit()
                    return f"submitted workflow run {run.id}"

                payload = self._get_serializer(launcher_name).dumps(((), {}))  # type: ignore[attr-defined]
                self._periodic_configs.append(
                    {
                        "name": launcher_name,
                        "task_name": launcher_name,
                        "cron_expr": cron,
                        "payload": payload,
                        "queue": queue,
                        "timezone": timezone,
                    }
                )
                return fn  # type: ignore[return-value]

            # Register as a normal task first
            wrapper = self.task(name=name, queue=queue)(fn)

            # Store periodic config for registration at worker startup
            payload = self._get_serializer(wrapper.name).dumps((args, kwargs or {}))  # type: ignore[attr-defined]
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
