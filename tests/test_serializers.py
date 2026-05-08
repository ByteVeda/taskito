"""Tests for pluggable serializers."""

import json
import pickle

import pytest

from taskito.serializers import CloudpickleSerializer, JsonSerializer, Serializer


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

        from taskito.serializers import EncryptedSerializer

        s1 = EncryptedSerializer(JsonSerializer(), os.urandom(32))
        s2 = EncryptedSerializer(JsonSerializer(), os.urandom(32))
        from cryptography.exceptions import InvalidTag

        encrypted = s1.dumps({"data": 1})
        with pytest.raises(InvalidTag):
            s2.loads(encrypted)

    def test_tampered_ciphertext_fails(self) -> None:
        pytest.importorskip("cryptography")
        import os

        from taskito.serializers import EncryptedSerializer

        key = os.urandom(32)
        s = EncryptedSerializer(JsonSerializer(), key)
        encrypted = s.dumps("hello")
        from cryptography.exceptions import InvalidTag

        tampered = encrypted[:-1] + bytes([encrypted[-1] ^ 0xFF])
        with pytest.raises(InvalidTag):
            s.loads(tampered)
