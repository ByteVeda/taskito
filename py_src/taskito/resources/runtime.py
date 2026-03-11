"""ResourceRuntime — initializes, resolves, and tears down worker resources."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from taskito.exceptions import (
    ResourceInitError,
    ResourceNotFoundError,
    ResourceUnavailableError,
)
from taskito.resources.definition import ResourceDefinition, ResourceScope
from taskito.resources.graph import topological_sort

logger = logging.getLogger("taskito.resources")


class ResourceRuntime:
    """Manages the lifecycle of scoped resources.

    Worker-scoped resources are initialized eagerly in dependency order.
    Task-scoped resources get a pool. Thread-scoped resources use thread-local storage.
    Request-scoped resources are created fresh per task.
    """

    def __init__(self, definitions: dict[str, ResourceDefinition]) -> None:
        self._definitions = dict(definitions)
        self._instances: dict[str, Any] = {}
        self._init_order: list[str] = []
        self._unhealthy: set[str] = set()
        self._recreation_count: dict[str, int] = {}
        self._init_duration: dict[str, float] = {}
        self._pools: dict[str, Any] = {}  # ResourcePool instances
        self._thread_locals: dict[str, Any] = {}  # ThreadLocalStore instances

    def initialize(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        """Create all resources in topological (dependency-first) order."""
        import time

        from taskito.resources.frozen import FrozenResource
        from taskito.resources.pool import PoolConfig, ResourcePool
        from taskito.resources.thread_local import ThreadLocalStore

        self._init_order = topological_sort(self._definitions)
        for name in self._init_order:
            defn = self._definitions[name]
            start = time.monotonic()

            if defn.scope == ResourceScope.WORKER:
                self._create_resource(name, loop)
                if defn.frozen and name in self._instances:
                    self._instances[name] = FrozenResource(self._instances[name], name)
            elif defn.scope == ResourceScope.TASK:
                pool_size = defn.pool_size or 4
                dep_kwargs = {dep: self._instances[dep] for dep in defn.depends_on}
                pool = ResourcePool(
                    name=name,
                    factory=defn.factory,
                    teardown=defn.teardown,
                    config=PoolConfig(
                        pool_size=pool_size,
                        pool_min=defn.pool_min,
                        acquire_timeout=defn.acquire_timeout,
                        max_lifetime=defn.max_lifetime,
                        idle_timeout=defn.idle_timeout,
                    ),
                    loop=loop,
                    dep_kwargs=dep_kwargs,
                )
                if defn.pool_min > 0:
                    pool.prewarm()
                self._pools[name] = pool
            elif defn.scope == ResourceScope.THREAD:
                dep_kwargs = {dep: self._instances[dep] for dep in defn.depends_on}
                store = ThreadLocalStore(
                    name=name,
                    factory=defn.factory,
                    teardown=defn.teardown,
                    loop=loop,
                    dep_kwargs=dep_kwargs,
                )
                self._thread_locals[name] = store
            elif defn.scope == ResourceScope.REQUEST:
                pass  # created fresh in acquire_for_task

            self._init_duration[name] = time.monotonic() - start

    def _create_resource(self, name: str, loop: asyncio.AbstractEventLoop | None = None) -> None:
        """Invoke a resource factory, injecting its declared dependencies."""
        defn = self._definitions[name]
        dep_kwargs = {dep: self._instances[dep] for dep in defn.depends_on}
        try:
            result = defn.factory(**dep_kwargs)
            if asyncio.iscoroutine(result):
                if loop is not None and loop.is_running():
                    future = asyncio.run_coroutine_threadsafe(result, loop)
                    result = future.result()
                else:
                    result = asyncio.run(result)
            self._instances[name] = result
            self._unhealthy.discard(name)
        except Exception as exc:
            raise ResourceInitError(f"Failed to initialize resource '{name}': {exc}") from exc

    def resolve(self, name: str) -> Any:
        """Return a live resource instance by name (worker scope only).

        For task/request scopes, use acquire_for_task() instead.

        Raises:
            ResourceNotFoundError: If the name was never registered.
            ResourceUnavailableError: If the resource is permanently unhealthy.
        """
        if name not in self._definitions and name not in self._instances:
            raise ResourceNotFoundError(f"Resource '{name}' is not registered")
        if name in self._unhealthy:
            raise ResourceUnavailableError(f"Resource '{name}' is permanently unhealthy")

        # Worker scope — direct return
        if name in self._instances:
            return self._instances[name]

        # Thread scope — thread-local access
        if name in self._thread_locals:
            return self._thread_locals[name].get_or_create()

        # Task/request scope shouldn't use resolve() directly
        if name in self._pools:
            raise ResourceUnavailableError(
                f"Resource '{name}' is task-scoped — use acquire_for_task() instead"
            )

        raise ResourceNotFoundError(f"Resource '{name}' is not initialized")

    def acquire_for_task(self, name: str) -> tuple[Any, Callable[[], None] | None]:
        """Acquire a resource for a single task execution.

        Returns:
            (instance, release_callback) where release_callback is None
            for worker/thread scopes and must be called after task completion
            for task/request scopes.
        """
        if name not in self._definitions and name not in self._instances:
            raise ResourceNotFoundError(f"Resource '{name}' is not registered")
        if name in self._unhealthy:
            raise ResourceUnavailableError(f"Resource '{name}' is permanently unhealthy")

        defn = self._definitions.get(name)
        scope = defn.scope if defn else ResourceScope.WORKER

        if scope == ResourceScope.WORKER:
            return self._instances[name], None

        if scope == ResourceScope.THREAD:
            return self._thread_locals[name].get_or_create(), None

        if scope == ResourceScope.TASK:
            pool = self._pools[name]
            instance = pool.acquire()

            def release() -> None:
                pool.release(instance)

            return instance, release

        if scope == ResourceScope.REQUEST:
            deps = defn.depends_on if defn else []
            dep_kwargs = {dep: self._instances.get(dep) for dep in deps}
            instance = defn.factory(**dep_kwargs) if defn else None
            if asyncio.iscoroutine(instance):
                loop = asyncio.get_event_loop_policy().get_event_loop()
                if loop.is_running():
                    instance = asyncio.run_coroutine_threadsafe(instance, loop).result()
                else:
                    instance = asyncio.run(instance)

            def teardown_request() -> None:
                if defn and defn.teardown is not None and instance is not None:
                    try:
                        defn.teardown(instance)
                    except Exception:
                        logger.exception("Error tearing down request resource '%s'", name)

            return instance, teardown_request

        return self._instances.get(name), None

    def recreate(self, name: str, loop: asyncio.AbstractEventLoop | None = None) -> bool:
        """Attempt to recreate a single resource. Returns True on success."""
        try:
            old = self._instances.get(name)
            defn = self._definitions[name]
            if old is not None and defn.teardown is not None:
                _call_maybe_async(defn.teardown, old, loop)
            self._create_resource(name, loop)
            self._recreation_count[name] = self._recreation_count.get(name, 0) + 1
            return True
        except ResourceInitError:
            return False

    def reload(self, names: list[str] | None = None) -> dict[str, bool]:
        """Reload reloadable resources. Returns {name: success} dict."""
        results: dict[str, bool] = {}
        targets = names or [n for n, d in self._definitions.items() if d.reloadable]
        # Reload in dependency order
        for name in self._init_order:
            if name not in targets:
                continue
            defn = self._definitions.get(name)
            if defn is None or (names is None and not defn.reloadable):
                continue
            results[name] = self.recreate(name)
        return results

    def mark_unhealthy(self, name: str) -> None:
        """Mark a resource as permanently unhealthy."""
        self._unhealthy.add(name)
        logger.error("Resource '%s' marked permanently unhealthy", name)

    def teardown(self) -> None:
        """Tear down all resources in reverse initialization order."""
        # Shutdown pools first
        for pool in self._pools.values():
            pool.shutdown()
        self._pools.clear()

        # Teardown thread-local stores
        for store in self._thread_locals.values():
            store.teardown_all()
        self._thread_locals.clear()

        # Teardown worker-scoped resources in reverse order
        for name in reversed(self._init_order):
            defn = self._definitions.get(name)
            instance = self._instances.pop(name, None)
            if defn is not None and defn.teardown is not None and instance is not None:
                try:
                    result = defn.teardown(instance)
                    if asyncio.iscoroutine(result):
                        loop = asyncio.get_event_loop_policy().get_event_loop()
                        if loop.is_running():
                            asyncio.run_coroutine_threadsafe(result, loop).result()
                        else:
                            asyncio.run(result)
                except Exception:
                    logger.exception("Error tearing down resource '%s'", name)
        self._init_order.clear()

    def status(self) -> list[dict[str, Any]]:
        """Return a summary of each resource's current state."""
        result: list[dict[str, Any]] = []
        for name in self._init_order:
            defn = self._definitions.get(name)
            if name in self._unhealthy:
                health = "unhealthy"
            elif name in self._instances or name in self._pools or name in self._thread_locals:
                health = "healthy"
            else:
                health = "unknown"
            entry: dict[str, Any] = {
                "name": name,
                "scope": defn.scope.value if defn else "worker",
                "health": health,
                "init_duration_ms": round(self._init_duration.get(name, 0) * 1000, 2),
                "recreations": self._recreation_count.get(name, 0),
                "depends_on": defn.depends_on if defn else [],
            }
            # Add pool stats for task-scoped resources
            if name in self._pools:
                entry["pool"] = self._pools[name].stats()
            result.append(entry)
        return result

    @classmethod
    def from_test_overrides(cls, instances: dict[str, Any]) -> ResourceRuntime:
        """Create a runtime pre-populated with mock/test instances.

        No factories are called — the provided instances are used directly.
        """
        rt = cls(definitions={})
        rt._instances = dict(instances)
        rt._init_order = list(instances.keys())
        return rt


def _call_maybe_async(fn: Any, *args: Any, loop: asyncio.AbstractEventLoop | None = None) -> Any:
    """Call a function, awaiting if it returns a coroutine."""
    result = fn(*args)
    if asyncio.iscoroutine(result):
        if loop is not None and loop.is_running():
            return asyncio.run_coroutine_threadsafe(result, loop).result()
        return asyncio.run(result)
    return result
