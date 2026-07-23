"""Resource proxies — transparent deconstruction and reconstruction of objects."""

from taskito.proxies.built_in import BuiltInProxy
from taskito.proxies.handler import ProxyHandler
from taskito.proxies.no_proxy import NoProxy
from taskito.proxies.reconstruct import cleanup_proxies, reconstruct_proxies
from taskito.proxies.registry import ProxyRegistry

__all__ = [
    "BuiltInProxy",
    "NoProxy",
    "ProxyHandler",
    "ProxyRegistry",
    "cleanup_proxies",
    "reconstruct_proxies",
]
