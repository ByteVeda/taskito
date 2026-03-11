"""Worker-side reconstruction and cleanup of proxy markers."""

from __future__ import annotations

import logging
import time
from concurrent.futures import (
    ThreadPoolExecutor,
)
from concurrent.futures import (
    TimeoutError as FuturesTimeout,
)
from typing import TYPE_CHECKING, Any

from taskito.exceptions import ProxyReconstructionError
from taskito.proxies.handler import ProxyHandler
from taskito.proxies.registry import ProxyRegistry

if TYPE_CHECKING:
    from taskito.proxies.metrics import ProxyMetrics

logger = logging.getLogger("taskito.proxies")

_PROXY_KEY = "__taskito_proxy__"
_REF_KEY = "__taskito_ref__"


def reconstruct_proxies(
    args: tuple,
    kwargs: dict,
    registry: ProxyRegistry,
    *,
    signing_secret: str | None = None,
    max_timeout: int = 10,
    metrics: ProxyMetrics | None = None,
) -> tuple[tuple, dict, list[tuple[ProxyHandler, Any]]]:
    """Walk args/kwargs, reconstruct ``__taskito_proxy__`` markers.

    Returns:
        (args, kwargs, cleanup_list) where cleanup_list contains
        (handler, reconstructed_object) pairs in reconstruction order.
    """
    identity_cache: dict[str, Any] = {}
    cleanup_list: list[tuple[ProxyHandler, Any]] = []

    new_args = tuple(
        _walk_proxy(
            v, registry, identity_cache, cleanup_list, signing_secret, max_timeout, metrics
        )
        for v in args
    )
    new_kwargs = {
        k: _walk_proxy(
            v, registry, identity_cache, cleanup_list, signing_secret, max_timeout, metrics
        )
        for k, v in kwargs.items()
    }
    return new_args, new_kwargs, cleanup_list


def cleanup_proxies(
    cleanup_list: list[tuple[ProxyHandler, Any]],
    metrics: ProxyMetrics | None = None,
) -> None:
    """Run cleanup on all reconstructed proxies in LIFO order."""
    for handler, obj in reversed(cleanup_list):
        try:
            handler.cleanup(obj)
        except Exception:
            logger.exception("Proxy cleanup failed for handler '%s'", handler.name)
            if metrics is not None:
                metrics.record_cleanup_error(handler.name)


def _walk_proxy(
    obj: Any,
    registry: ProxyRegistry,
    identity_cache: dict[str, Any],
    cleanup_list: list[tuple[ProxyHandler, Any]],
    signing_secret: str | None,
    max_timeout: int,
    metrics: ProxyMetrics | None,
) -> Any:
    """Recursively walk a value, reconstructing proxy markers."""
    if obj is None:
        return obj

    if isinstance(obj, dict):
        if obj.get(_PROXY_KEY):
            return _reconstruct_one(
                obj, registry, identity_cache, cleanup_list, signing_secret, max_timeout, metrics
            )
        if _REF_KEY in obj:
            identity = obj[_REF_KEY]
            if identity in identity_cache:
                return identity_cache[identity]
            raise ProxyReconstructionError(
                f"Proxy reference '{identity}' not found in identity cache"
            )
        # Regular dict — recurse
        return {
            k: _walk_proxy(
                v, registry, identity_cache, cleanup_list, signing_secret, max_timeout, metrics
            )
            for k, v in obj.items()
        }

    if isinstance(obj, (list, tuple)):
        walked = [
            _walk_proxy(
                v, registry, identity_cache, cleanup_list, signing_secret, max_timeout, metrics
            )
            for v in obj
        ]
        return type(obj)(walked)

    return obj


def _reconstruct_one(
    marker: dict[str, Any],
    registry: ProxyRegistry,
    identity_cache: dict[str, Any],
    cleanup_list: list[tuple[ProxyHandler, Any]],
    signing_secret: str | None,
    max_timeout: int,
    metrics: ProxyMetrics | None,
) -> Any:
    """Reconstruct a single __taskito_proxy__ marker."""
    handler_name = marker["handler"]
    version = marker["version"]
    recipe = marker["recipe"]
    identity = marker.get("identity")

    # Check identity cache first (deduplication)
    if identity and identity in identity_cache:
        return identity_cache[identity]

    handler = registry.get(handler_name)
    if handler is None:
        raise ProxyReconstructionError(f"No proxy handler registered for '{handler_name}'")

    # Verify recipe signature if signing is enabled
    if signing_secret is not None:
        checksum = marker.get("checksum")
        if checksum is None:
            raise ProxyReconstructionError(
                f"Recipe for '{handler_name}' is missing checksum (signing is enabled)"
            )
        from taskito.proxies.signing import verify_recipe

        try:
            verify_recipe(handler_name, version, recipe, checksum, signing_secret)
        except ProxyReconstructionError:
            if metrics is not None:
                metrics.record_checksum_failure(handler_name)
            raise

    # Schema validation
    handler_schema = getattr(handler, "schema", None)
    if handler_schema is not None:
        from taskito.proxies.schema import validate_recipe

        validate_recipe(handler_name, recipe, handler_schema)

    # Version migration
    handler_version = getattr(handler, "version", version)
    if version != handler_version and hasattr(handler, "migrate"):
        recipe = handler.migrate(recipe, version, handler_version)

    # Reconstruct with timeout
    start = time.monotonic()
    try:
        if max_timeout > 0:
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(handler.reconstruct, recipe, version)
                try:
                    obj = future.result(timeout=max_timeout)
                except FuturesTimeout:
                    raise ProxyReconstructionError(
                        f"Reconstruction of '{handler_name}' timed out after {max_timeout}s"
                    ) from None
        else:
            obj = handler.reconstruct(recipe, version)
    except ProxyReconstructionError:
        if metrics is not None:
            metrics.record_error(handler_name)
        raise
    except Exception as exc:
        if metrics is not None:
            metrics.record_error(handler_name)
        raise ProxyReconstructionError(
            f"Failed to reconstruct proxy '{handler_name}': {exc}"
        ) from exc
    finally:
        duration_ms = (time.monotonic() - start) * 1000
        if metrics is not None:
            metrics.record_reconstruction(handler_name, duration_ms)

    if identity:
        identity_cache[identity] = obj
    cleanup_list.append((handler, obj))
    return obj
