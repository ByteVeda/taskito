"""Worker resource registration, health checks, and metrics."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from taskito.exceptions import CircularDependencyError
from taskito.resources.definition import ResourceDefinition, ResourceScope
from taskito.resources.graph import detect_cycle
from taskito.resources.toml_config import load_resources_from_toml

if TYPE_CHECKING:
    from taskito.interception.metrics import InterceptionMetrics
    from taskito.proxies.metrics import ProxyMetrics
    from taskito.resources.runtime import ResourceRuntime


class QueueResourceMixin:
    """Worker resource registration, health checks, and proxy/interception stats."""

    _resource_definitions: dict[str, ResourceDefinition]
    _resource_runtime: ResourceRuntime | None
    _proxy_metrics: ProxyMetrics
    _interception_metrics: InterceptionMetrics | None

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

    def reload_resources(self, names: list[str] | None = None) -> dict[str, bool]:
        """Hot-reload reloadable worker resources (programmatic SIGHUP).

        Tears down and re-creates each target resource in dependency order.

        Args:
            names: Resource names to reload. ``None`` reloads every resource
                registered with ``reloadable=True``.

        Returns:
            Mapping of resource name to reload success. Empty when no worker
            resource runtime is active in this process (no worker running).
        """
        runtime = self._resource_runtime
        if runtime is None:
            return {}
        return runtime.reload(names)

    def load_resources(self, toml_path: str) -> None:
        """Load resource definitions from a TOML file.

        Must be called before ``run_worker()``.

        Args:
            toml_path: Path to the TOML configuration file.
        """
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
