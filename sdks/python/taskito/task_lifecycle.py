"""The lifecycle one task runs through, shared by both dispatch paths.

A task reaches the worker one of two ways: the blocking path, where Rust calls
the wrapped function on a pool thread, or native async dispatch, where the
executor awaits the coroutine on its own event loop. Everything between "we have
the arguments" and "we have a result" is identical, and lives here.

It lives here rather than in either caller because the two used to reimplement it
separately, and drifted: the native copy silently lost the queue hooks, the saga
compensation context, ``soft_timeout`` and per-item batch handling. One body
means a new lifecycle concern cannot reach one path and miss the other.

The callers keep only what genuinely differs — how arguments arrive, and how the
result is delivered:

===================  ==========================  =============================
                     blocking                    native async
===================  ==========================  =============================
payload/result       Rust calls the queue's      the executor calls them
                     (de)serializers             directly
delivery             return/raise to Rust        ``PyResultSender``
job context          ``_set_context`` (thread)   ``set_async_context`` (ctxvar)
===================  ==========================  =============================

The context split needs no handling here: ``JobContext._require_context`` reads
the contextvar first and falls back to the thread-local, so ``current_job``
resolves on either path.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from taskito.async_support.helpers import run_maybe_async
from taskito.batching.item_result import (
    BatchPartialFailureError,
    BatchResultTypeError,
    is_batch_item_result_list,
)
from taskito.context import current_job
from taskito.events import EventType
from taskito.exceptions import TaskCancelledError
from taskito.interception.reconstruct import reconstruct_args
from taskito.proxies import cleanup_proxies, reconstruct_proxies
from taskito.workflows.saga.context import (
    _reset_compensation_context,
    _set_compensation_context,
)

if TYPE_CHECKING:
    from taskito.app import Queue

logger = logging.getLogger("taskito")

_MAX_RESULT_REPR = 80


def _safe_result_repr(value: Any) -> str:
    """Render a task return value for the success log, bounded and crash-proof."""
    if value is None:
        return "None"
    try:
        text = repr(value)
    except Exception:
        return "<unrepresentable>"
    if len(text) > _MAX_RESULT_REPR:
        return text[: _MAX_RESULT_REPR - 1] + "…"
    return text


async def run_lifecycle(
    queue_ref: Queue,
    task_name: str,
    fn: Callable,
    args: Any,
    kwargs: Any,
    *,
    is_async: bool,
) -> Any:
    """Run one task end to end: gates, reconstruction, injection, middleware, hooks.

    Returns the task's raw return value, or raises what it raised — delivery
    belongs to the caller, which knows whether it is answering Rust or a result
    sender. ``args``/``kwargs`` arrive already deserialized.

    ``is_async`` selects how the body is invoked: awaited directly when the task
    is a coroutine function (native dispatch), or driven to completion by
    ``run_maybe_async`` when it is not. A blocking caller must therefore drive
    the whole coroutine with ``run_maybe_async``; a native one awaits it.
    """
    job_id = current_job.id
    logger.info("Task %s[%s] received", task_name, job_id)
    started_at = time.perf_counter()

    # Worker-dispatch predicate gate. Evaluated on the raw deserialized payload
    # (before arg/proxy reconstruction) so re-enqueue on defer can round-trip
    # cleanly.
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
    hooks = queue_ref._hooks

    # Set soft timeout on context if configured
    soft_timeout = queue_ref._task_soft_timeouts.get(task_name)
    if soft_timeout is not None:
        current_job._set_soft_timeout(soft_timeout)

    # Run middleware before hooks (skipping middlewares whose predicate filter
    # excludes this job)
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

    # Saga compensation context: if this job was dispatched by the saga
    # orchestrator, look up the in-memory CompensationContext and push it onto a
    # contextvar so the compensator body can call
    # ``current_compensation_context()`` to introspect the forward execution.
    # Pop in the ``finally`` below.
    comp_ctx_token = None
    tracker = getattr(queue_ref, "_workflow_tracker", None)
    saga = getattr(tracker, "_saga", None) if tracker is not None else None
    if saga is not None and saga.is_compensation_job(job_id):
        comp_ctx = saga.take_compensation_context(job_id)
        if comp_ctx is not None:
            comp_ctx_token = _set_compensation_context(comp_ctx)

    # `torn_down` tracks a BaseException separately from a task failure: both must
    # keep the cleanup below from reporting success, but only a failure is one.
    error: BaseException | None = None
    torn_down = False
    result = None
    try:
        called = fn(*args, **kwargs)
        # Native dispatch awaits the coroutine on the executor's loop; the
        # blocking path has no loop of its own, so run_maybe_async drives it.
        ret = await called if is_async else run_maybe_async(called)
        # Per-item batch result: when the task is batched with
        # per_item_results=True, enforce the return type contract and surface
        # partial failures via BatchPartialFailureError so the existing
        # retry/DLQ machinery applies.
        batch_cfg = queue_ref._task_batch_configs.get(task_name)
        if batch_cfg is not None and getattr(batch_cfg, "per_item_results", False):
            if not is_batch_item_result_list(ret):
                raise BatchResultTypeError(
                    f"task {task_name!r} declares per_item_results=True but "
                    f"returned {type(ret).__name__} instead of "
                    f"list[BatchItemResult]"
                )
            failed = [item for item in ret if item.status == "failure"]
            if failed:
                # Pass the result through so the worker can still store it
                # (per-item outcomes are stored verbatim); the existing
                # on_failure path emits JOB_FAILED.
                result = ret
                raise BatchPartialFailureError(failed_items=failed)
        result = ret
    except Exception as exc:
        error = exc
        elapsed = time.perf_counter() - started_at
        if isinstance(exc, TaskCancelledError):
            logger.info(
                "Task %s[%s] cancelled in %.3fs: %s",
                task_name,
                job_id,
                elapsed,
                exc,
            )
        else:
            logger.error(
                "Task %s[%s] raised %s in %.3fs: %r",
                task_name,
                job_id,
                type(exc).__name__,
                elapsed,
                exc,
            )
        for hook in hooks["on_failure"]:
            hook(task_name, args, kwargs, exc)
        raise
    except BaseException as exc:
        # asyncio.CancelledError is a BaseException, so the clause above cannot see
        # it — and native dispatch raises one on every cancellation and loop
        # shutdown. Record it, or the cleanup below reads `error is None` and calls
        # a task that never returned a success. The failure hooks stay out of it:
        # being torn down is not the task failing, and the disposition event comes
        # from the outcome loop (JOB_CANCELLED), not from here.
        error = exc
        torn_down = True
        logger.info(
            "Task %s[%s] torn down after %.3fs by %s",
            task_name,
            job_id,
            time.perf_counter() - started_at,
            type(exc).__name__,
        )
        raise
    else:
        elapsed = time.perf_counter() - started_at
        logger.info(
            "Task %s[%s] succeeded in %.3fs: %s",
            task_name,
            job_id,
            elapsed,
            _safe_result_repr(result),
        )
        for hook in hooks["on_success"]:
            hook(task_name, args, kwargs, result)
        return result
    finally:
        # Pop the saga compensation context (no-op outside saga flow).
        if comp_ctx_token is not None:
            _reset_compensation_context(comp_ctx_token)
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
        # Emit job lifecycle events. The Rust outcome loop skips Success on the
        # grounds that this body emits it, so it must stay here for both paths.
        # A torn-down job is the exception: it has no outcome to report yet, and
        # the outcome loop emits its own (JOB_CANCELLED, or JOB_RETRYING/JOB_DEAD
        # once the failure is classified).
        if not torn_down:
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
