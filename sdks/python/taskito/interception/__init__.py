"""Intelligent argument interception for taskito.

Three layers of argument handling before serialization:
- PASS: natively serializable, zero overhead
- CONVERT: auto-transform (UUID, datetime, Pydantic, dataclass, etc.)
- REDIRECT: substitute DI marker for worker-side resource injection
- PROXY: extract recipe for worker-side reconstruction (Phase 3)
- REJECT: raise with actionable error message
"""

from taskito.interception.errors import ArgumentFailure, InterceptionError
from taskito.interception.interceptor import ArgumentInterceptor, InterceptionReport
from taskito.interception.reconstruct import reconstruct_args
from taskito.interception.registry import TypeRegistry
from taskito.interception.strategy import Strategy

__all__ = [
    "ArgumentFailure",
    "ArgumentInterceptor",
    "InterceptionError",
    "InterceptionReport",
    "Strategy",
    "TypeRegistry",
    "reconstruct_args",
]
