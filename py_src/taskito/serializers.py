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


class MsgPackSerializer:
    """MsgPack-based serializer for compact, cross-language payloads.

    Requires the ``msgpack`` extra::

        pip install taskito[msgpack]
    """

    def dumps(self, obj: Any) -> bytes:
        import msgpack

        return bytes(msgpack.packb(obj, use_bin_type=True))

    def loads(self, data: bytes) -> Any:
        import msgpack

        return msgpack.unpackb(data, raw=False)


class EncryptedSerializer:
    """Wraps another serializer with AES-256-GCM encryption at rest.

    Requires the ``encryption`` extra::

        pip install taskito[encryption]

    Usage::

        from taskito import EncryptedSerializer, CloudpickleSerializer
        key = os.urandom(32)  # 256-bit key
        serializer = EncryptedSerializer(CloudpickleSerializer(), key)
        queue = Queue(serializer=serializer)
    """

    def __init__(self, inner: Serializer, key: bytes):
        if not isinstance(key, bytes):
            raise TypeError(f"key must be bytes, got {type(key).__name__}")
        if len(key) not in (16, 24, 32):
            raise ValueError(
                f"key must be 16, 24, or 32 bytes for AES-128/192/256, got {len(key)} bytes"
            )

        from cryptography.hazmat.primitives.ciphers.aead import (
            AESGCM,
        )

        self._inner = inner
        self._aesgcm = AESGCM(key)

    def dumps(self, obj: Any) -> bytes:
        import os

        plaintext = self._inner.dumps(obj)
        nonce = os.urandom(12)
        return bytes(nonce + self._aesgcm.encrypt(nonce, plaintext, None))

    def loads(self, data: bytes) -> Any:
        nonce, ciphertext = data[:12], data[12:]
        plaintext = self._aesgcm.decrypt(nonce, ciphertext, None)
        return self._inner.loads(plaintext)
