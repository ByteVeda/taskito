"""Worker-side reconstruction and cleanup of proxy markers."""

from __future__ import annotations

import logging
from typing import Any

from taskito.exceptions import ProxyReconstructionError
from taskito.proxies.handler import ProxyHandler
from taskito.proxies.registry import ProxyRegistry

logger = logging.getLogger("taskito.proxies")

_PROXY_KEY = "__taskito_proxy__"
_REF_KEY = "__taskito_ref__"


def reconstruct_proxies(
    args: tuple,
    kwargs: dict,
    registry: ProxyRegistry,
) -> tuple[tuple, dict, list[tuple[ProxyHandler, Any]]]:
    """Walk args/kwargs, reconstruct ``__taskito_proxy__`` markers.

    Returns:
        (args, kwargs, cleanup_list) where cleanup_list contains
        (handler, reconstructed_object) pairs in reconstruction order.
    """
    identity_cache: dict[str, Any] = {}
    cleanup_list: list[tuple[ProxyHandler, Any]] = []

    new_args = tuple(_walk_proxy(v, registry, identity_cache, cleanup_list) for v in args)
    new_kwargs = {
        k: _walk_proxy(v, registry, identity_cache, cleanup_list) for k, v in kwargs.items()
    }
    return new_args, new_kwargs, cleanup_list


def cleanup_proxies(cleanup_list: list[tuple[ProxyHandler, Any]]) -> None:
    """Run cleanup on all reconstructed proxies in LIFO order."""
    for handler, obj in reversed(cleanup_list):
        try:
            handler.cleanup(obj)
        except Exception:
            logger.exception("Proxy cleanup failed for handler '%s'", handler.name)


def _walk_proxy(
    obj: Any,
    registry: ProxyRegistry,
    identity_cache: dict[str, Any],
    cleanup_list: list[tuple[ProxyHandler, Any]],
) -> Any:
    """Recursively walk a value, reconstructing proxy markers."""
    if obj is None:
        return obj

    if isinstance(obj, dict):
        if obj.get(_PROXY_KEY):
            return _reconstruct_one(obj, registry, identity_cache, cleanup_list)
        if _REF_KEY in obj:
            identity = obj[_REF_KEY]
            if identity in identity_cache:
                return identity_cache[identity]
            raise ProxyReconstructionError(
                f"Proxy reference '{identity}' not found in identity cache"
            )
        # Regular dict — recurse
        return {k: _walk_proxy(v, registry, identity_cache, cleanup_list) for k, v in obj.items()}

    if isinstance(obj, (list, tuple)):
        walked = [_walk_proxy(v, registry, identity_cache, cleanup_list) for v in obj]
        return type(obj)(walked)

    return obj


def _reconstruct_one(
    marker: dict[str, Any],
    registry: ProxyRegistry,
    identity_cache: dict[str, Any],
    cleanup_list: list[tuple[ProxyHandler, Any]],
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

    try:
        obj = handler.reconstruct(recipe, version)
    except Exception as exc:
        raise ProxyReconstructionError(
            f"Failed to reconstruct proxy '{handler_name}': {exc}"
        ) from exc

    if identity:
        identity_cache[identity] = obj
    cleanup_list.append((handler, obj))
    return obj
