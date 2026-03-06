"""Pluggable serializer protocol and built-in implementations."""

from __future__ import annotations

import json
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class Serializer(Protocol):
    """Protocol for task argument/result serialization."""

    def dumps(self, obj: Any) -> bytes:
        """Serialize an object to bytes."""
        ...

    def loads(self, data: bytes) -> Any:
        """Deserialize bytes back to an object."""
        ...


class CloudpickleSerializer:
    """Default serializer using cloudpickle (handles lambdas, closures, etc.)."""

    def dumps(self, obj: Any) -> bytes:
        import cloudpickle

        return cloudpickle.dumps(obj)  # type: ignore[no-any-return]

    def loads(self, data: bytes) -> Any:
        import cloudpickle

        return cloudpickle.loads(data)


class JsonSerializer:
    """JSON-based serializer for simple, cross-language payloads."""

    def dumps(self, obj: Any) -> bytes:
        return json.dumps(obj).encode("utf-8")

    def loads(self, data: bytes) -> Any:
        return json.loads(data.decode("utf-8"))
