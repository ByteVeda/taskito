"""Task and periodic decorators, lifecycle hooks, and registration."""

from __future__ import annotations

import contextlib
import functools
import inspect
import os
import sys
import typing
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from taskito._taskito import PyTaskConfig
from taskito.inject import Inject, _InjectAlias
from taskito.interception.strategy import Strategy as S
from taskito.task import TaskWrapper

if TYPE_CHECKING:
    from taskito.interception import ArgumentInterceptor
    from taskito.middleware import TaskMiddleware
    from taskito.serializers import Serializer


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
    _interceptor: ArgumentInterceptor | None
    _queue_configs: dict[str, dict[str, Any]]

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
        """

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

            # Store inject map for resource injection
            if final_inject:
                self._task_inject_map[task_name] = final_inject

            # Wrap the function with hooks, middleware, and context
            wrapped = self._wrap_task(fn, task_name, soft_timeout)  # type: ignore[attr-defined]
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

    # -- Type registration --

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

    # -- Queue-level config --

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
