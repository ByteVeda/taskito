"""Tests for pluggable serializers."""

import json
import pickle

import pytest

from taskito.serializers import (
    CloudpickleSerializer,
    JsonSerializer,
    Serializer,
    SmartSerializer,
)


class TestJsonSerializer:
    def test_roundtrip_dict(self) -> None:
        s = JsonSerializer()
        data = {"key": "value", "num": 42, "nested": [1, 2, 3]}
        assert s.loads(s.dumps(data)) == data

    def test_roundtrip_list(self) -> None:
        s = JsonSerializer()
        data = [1, "two", None, True]
        assert s.loads(s.dumps(data)) == data

    def test_roundtrip_primitives(self) -> None:
        s = JsonSerializer()
        for val in [42, 3.14, "hello", True, None]:
            assert s.loads(s.dumps(val)) == val

    def test_dumps_returns_bytes(self) -> None:
        s = JsonSerializer()
        result = s.dumps({"a": 1})
        assert isinstance(result, bytes)

    def test_non_serializable_raises(self) -> None:
        s = JsonSerializer()
        with pytest.raises(TypeError):
            s.dumps(object())

    def test_invalid_bytes_raises(self) -> None:
        s = JsonSerializer()
        with pytest.raises((json.JSONDecodeError, UnicodeDecodeError, ValueError)):
            s.loads(b"\xff\xfe")


class TestCloudpickleSerializer:
    def test_roundtrip_dict(self) -> None:
        s = CloudpickleSerializer()
        data = {"key": "value", "num": 42}
        assert s.loads(s.dumps(data)) == data

    def test_roundtrip_lambda(self) -> None:
        s = CloudpickleSerializer()
        fn = lambda x: x * 2  # noqa: E731
        restored = s.loads(s.dumps(fn))
        assert restored(5) == 10

    def test_dumps_returns_bytes(self) -> None:
        s = CloudpickleSerializer()
        assert isinstance(s.dumps(42), bytes)

    def test_invalid_bytes_raises(self) -> None:
        s = CloudpickleSerializer()
        with pytest.raises((pickle.UnpicklingError, EOFError)):
            s.loads(b"not-valid-pickle")


class TestSerializerProtocol:
    def test_json_is_serializer(self) -> None:
        assert isinstance(JsonSerializer(), Serializer)

    def test_cloudpickle_is_serializer(self) -> None:
        assert isinstance(CloudpickleSerializer(), Serializer)


class TestMsgPackSerializer:
    def test_roundtrip(self) -> None:
        pytest.importorskip("msgpack")
        from taskito.serializers import MsgPackSerializer

        s = MsgPackSerializer()
        data = {"key": "value", "num": 42}
        assert s.loads(s.dumps(data)) == data

    def test_dumps_returns_bytes(self) -> None:
        pytest.importorskip("msgpack")
        from taskito.serializers import MsgPackSerializer

        s = MsgPackSerializer()
        assert isinstance(s.dumps([1, 2, 3]), bytes)


class TestEncryptedSerializer:
    def test_roundtrip(self) -> None:
        pytest.importorskip("cryptography")
        import os

        from taskito.serializers import EncryptedSerializer

        key = os.urandom(32)
        s = EncryptedSerializer(JsonSerializer(), key)
        data = {"secret": "payload"}
        assert s.loads(s.dumps(data)) == data

    def test_wrong_key_fails(self) -> None:
        pytest.importorskip("cryptography")
        import os

        from cryptography.exceptions import InvalidTag

        from taskito.serializers import EncryptedSerializer

        s1 = EncryptedSerializer(JsonSerializer(), os.urandom(32))
        s2 = EncryptedSerializer(JsonSerializer(), os.urandom(32))

        encrypted = s1.dumps({"data": 1})
        with pytest.raises(ValueError, match="Decryption failed") as excinfo:
            s2.loads(encrypted)
        # The original cryptography exception is preserved on the cause
        # chain so debugging surfaces still know it was a tag-validation
        # failure rather than a malformed-input ValueError.
        assert isinstance(excinfo.value.__cause__, InvalidTag)

    def test_tampered_ciphertext_fails(self) -> None:
        pytest.importorskip("cryptography")
        import os

        from cryptography.exceptions import InvalidTag

        from taskito.serializers import EncryptedSerializer

        key = os.urandom(32)
        s = EncryptedSerializer(JsonSerializer(), key)
        encrypted = s.dumps("hello")

        tampered = encrypted[:-1] + bytes([encrypted[-1] ^ 0xFF])
        with pytest.raises(ValueError, match="Decryption failed") as excinfo:
            s.loads(tampered)
        assert isinstance(excinfo.value.__cause__, InvalidTag)

    def test_short_ciphertext_fails(self) -> None:
        """Inputs shorter than the AES-GCM nonce (12B) + tag (≥1B) are
        rejected before the cipher is ever consulted, with a distinct
        message so operators can tell parsing errors from key/tag failures.
        """
        pytest.importorskip("cryptography")
        import os

        from taskito.serializers import EncryptedSerializer

        s = EncryptedSerializer(JsonSerializer(), os.urandom(32))
        with pytest.raises(ValueError, match="too short"):
            s.loads(b"only-twelve-")


class TestSmartSerializer:
    def test_plain_data_uses_msgpack_tag(self) -> None:
        s = SmartSerializer()
        encoded = s.dumps({"x": 1, "y": ["a", "b"]})
        assert encoded[:1] == b"\x01"
        assert s.loads(encoded) == {"x": 1, "y": ["a", "b"]}

    def test_falls_back_to_cloudpickle_for_lambda(self) -> None:
        s = SmartSerializer()
        encoded = s.dumps(lambda x: x + 1)
        assert encoded[:1] == b"\x00"
        assert s.loads(encoded)(41) == 42

    def test_falls_back_to_cloudpickle_for_custom_class(self) -> None:
        s = SmartSerializer()

        class Point:
            def __init__(self, x: int) -> None:
                self.x = x

        encoded = s.dumps(Point(7))
        assert encoded[:1] == b"\x00"
        assert s.loads(encoded).x == 7

    def test_loads_legacy_untagged_cloudpickle(self) -> None:
        """Payloads written before the envelope existed are raw cloudpickle
        and must still deserialize."""
        legacy = CloudpickleSerializer().dumps({"legacy": True})
        # A protocol-2+ pickle starts with 0x80, never a codec tag.
        assert legacy[:1] not in (b"\x00", b"\x01")
        assert SmartSerializer().loads(legacy) == {"legacy": True}

    def test_preserves_tuples(self) -> None:
        """Tuples round-trip as tuples (not lists) via the msgpack ExtType,
        including nested ones — so task args/results keep exact semantics."""
        s = SmartSerializer()
        payload = ((1, "two", 3.0), {"k": ("nested", "tuple")})
        restored = s.loads(s.dumps(payload))
        assert restored == payload
        assert isinstance(restored[0], tuple)
        assert isinstance(restored[1]["k"], tuple)

    def test_empty_payload_rejected(self) -> None:
        with pytest.raises(ValueError, match="empty payload"):
            SmartSerializer().loads(b"")

    def test_satisfies_protocol(self) -> None:
        assert isinstance(SmartSerializer(), Serializer)
