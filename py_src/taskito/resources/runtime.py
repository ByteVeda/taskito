"""ResourceRuntime — initializes, resolves, and tears down worker resources."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from taskito.exceptions import (
    ResourceInitError,
    ResourceNotFoundError,
    ResourceUnavailableError,
)
from taskito.resources.definition import ResourceDefinition
from taskito.resources.graph import topological_sort

logger = logging.getLogger("taskito.resources")


class ResourceRuntime:
    """Manages the lifecycle of worker-scoped resources.

    Resources are initialized in dependency order and torn down in reverse.
    """

    def __init__(self, definitions: dict[str, ResourceDefinition]) -> None:
        self._definitions = dict(definitions)
        self._instances: dict[str, Any] = {}
        self._init_order: list[str] = []
        self._unhealthy: set[str] = set()
        self._recreation_count: dict[str, int] = {}
        self._init_duration: dict[str, float] = {}

    def initialize(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        """Create all resources in topological (dependency-first) order."""
        import time

        self._init_order = topological_sort(self._definitions)
        for name in self._init_order:
            start = time.monotonic()
            self._create_resource(name, loop)
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
        """Return a live resource instance by name.

        Raises:
            ResourceNotFoundError: If the name was never registered.
            ResourceUnavailableError: If the resource is permanently unhealthy.
        """
        if name not in self._definitions and name not in self._instances:
            raise ResourceNotFoundError(f"Resource '{name}' is not registered")
        if name in self._unhealthy:
            raise ResourceUnavailableError(f"Resource '{name}' is permanently unhealthy")
        return self._instances[name]

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

    def mark_unhealthy(self, name: str) -> None:
        """Mark a resource as permanently unhealthy."""
        self._unhealthy.add(name)
        logger.error("Resource '%s' marked permanently unhealthy", name)

    def teardown(self) -> None:
        """Tear down all resources in reverse initialization order."""
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
        """Return a summary of each resource's current state.

        Each entry contains: name, scope, health, init_duration_ms,
        recreations, depends_on.
        """
        result: list[dict[str, Any]] = []
        for name in self._init_order:
            defn = self._definitions.get(name)
            if name in self._unhealthy:
                health = "unhealthy"
            elif name in self._instances:
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
