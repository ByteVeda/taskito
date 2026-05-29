"""Pluggable serializer protocol and built-in implementations."""

from __future__ import annotations

import json
from typing import Any, Protocol, runtime_checkable

import cloudpickle
import msgpack

# Format tags for the envelope written by ``SmartSerializer``. A legacy
# cloudpickle payload starts with the pickle protocol-2+ opcode ``\x80``, which
# never collides with these tags — so untagged bytes are unambiguously legacy.
_CODEC_CLOUDPICKLE = b"\x00"
_CODEC_MSGPACK = b"\x01"

# msgpack has no native tuple type and would silently flatten tuples to lists.
# A custom ExtType preserves them so payloads round-trip with exact Python
# semantics (a task returning ``(1, 2)`` gets back ``(1, 2)``, not ``[1, 2]``).
_EXT_TUPLE = 0


def _msgpack_default(obj: Any) -> Any:
    """Encode types msgpack can't represent natively.

    Tuples become a tagged ExtType (recursively packed). Anything else raises,
    which ``SmartSerializer`` catches to fall back to cloudpickle.
    """
    if isinstance(obj, tuple):
        return msgpack.ExtType(_EXT_TUPLE, _msgpack_packb(list(obj)))
    raise TypeError(f"Cannot msgpack-encode {type(obj).__name__}")


def _msgpack_ext_hook(code: int, data: bytes) -> Any:
    if code == _EXT_TUPLE:
        return tuple(_msgpack_unpackb(data))
    return msgpack.ExtType(code, data)


def _msgpack_packb(obj: Any) -> bytes:
    # ``strict_types`` ensures tuples reach ``default`` instead of being
    # auto-coerced to arrays; subclasses also route to the cloudpickle fallback.
    return bytes(
        msgpack.packb(obj, use_bin_type=True, strict_types=True, default=_msgpack_default)
    )


def _msgpack_unpackb(data: bytes) -> Any:
    return msgpack.unpackb(data, raw=False, ext_hook=_msgpack_ext_hook)


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
        return cloudpickle.dumps(obj)  # type: ignore[no-any-return]

    def loads(self, data: bytes) -> Any:
        return cloudpickle.loads(data)


class JsonSerializer:
    """JSON-based serializer for simple, cross-language payloads."""

    def dumps(self, obj: Any) -> bytes:
        return json.dumps(obj).encode("utf-8")

    def loads(self, data: bytes) -> Any:
        try:
            return json.loads(data.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
            raise ValueError(f"JSON deserialization failed: {exc}") from exc


class MsgPackSerializer:
    """MsgPack-based serializer for compact, cross-language payloads.

    Only handles msgpack-native types. For arbitrary Python objects use
    :class:`SmartSerializer`, which falls back to cloudpickle.
    """

    def dumps(self, obj: Any) -> bytes:
        return bytes(msgpack.packb(obj, use_bin_type=True))

    def loads(self, data: bytes) -> Any:
        return msgpack.unpackb(data, raw=False)


class SmartSerializer:
    """Default serializer: msgpack for plain payloads, cloudpickle fallback.

    Plain data (the common case) serializes via msgpack — faster and more
    compact than cloudpickle. Anything msgpack can't encode (lambdas, closures,
    arbitrary class instances) transparently falls back to cloudpickle. A
    one-byte tag records which codec produced each payload.

    Tuples are preserved (via a msgpack ExtType), so payloads round-trip with
    exact Python semantics.

    Backward compatible: untagged payloads (written by older versions, raw
    cloudpickle) are detected and loaded as cloudpickle.
    """

    def dumps(self, obj: Any) -> bytes:
        try:
            return _CODEC_MSGPACK + _msgpack_packb(obj)
        except Exception:
            # msgpack rejects non-native types (lambdas, custom classes, …);
            # cloudpickle handles them.
            return _CODEC_CLOUDPICKLE + bytes(cloudpickle.dumps(obj))

    def loads(self, data: bytes) -> Any:
        if not data:
            raise ValueError("Cannot deserialize empty payload")
        tag, body = data[:1], data[1:]
        if tag == _CODEC_MSGPACK:
            return _msgpack_unpackb(body)
        if tag == _CODEC_CLOUDPICKLE:
            return cloudpickle.loads(body)
        # Untagged: a legacy cloudpickle payload from before the envelope existed.
        return cloudpickle.loads(data)


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

        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives.ciphers.aead import (
            AESGCM,
        )

        self._inner = inner
        self._aesgcm = AESGCM(key)
        # Cache the exception class so ``loads`` doesn't re-import per call.
        self._invalid_tag = InvalidTag

    def dumps(self, obj: Any) -> bytes:
        import os

        plaintext = self._inner.dumps(obj)
        nonce = os.urandom(12)
        return bytes(nonce + self._aesgcm.encrypt(nonce, plaintext, None))

    def loads(self, data: bytes) -> Any:
        if len(data) < 13:
            raise ValueError("Encrypted data too short")
        nonce, ciphertext = data[:12], data[12:]
        try:
            plaintext = self._aesgcm.decrypt(nonce, ciphertext, None)
        except self._invalid_tag as exc:
            # Wrap so callers don't need to import cryptography.exceptions
            # to handle decryption failures. The original ``InvalidTag`` is
            # preserved in ``__cause__`` for debugging.
            raise ValueError("Decryption failed: invalid authentication tag") from exc
        return self._inner.loads(plaintext)
