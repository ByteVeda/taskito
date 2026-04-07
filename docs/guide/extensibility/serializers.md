# Pluggable Serializers

taskito uses a pluggable serializer for task arguments and results. By default, it uses `CloudpickleSerializer`, but you can switch to `JsonSerializer` or provide your own.

## Built-in Serializers

### CloudpickleSerializer (default)

Handles lambdas, closures, and complex Python objects. This is the default — no configuration needed.

```python
from taskito import Queue

queue = Queue()  # uses CloudpickleSerializer
```

### JsonSerializer

Produces human-readable JSON payloads. Useful for debugging, cross-language interop, or when you only pass simple types (strings, numbers, dicts, lists).

```python
from taskito import Queue, JsonSerializer

queue = Queue(serializer=JsonSerializer())
```

### MsgPackSerializer

MessagePack serialization: faster than cloudpickle, produces smaller payloads, and is cross-language compatible. Requires the `msgpack` package.

```bash
pip install msgpack
```

```python
from taskito.serializers import MsgPackSerializer

queue = Queue(serializer=MsgPackSerializer())
```

!!! note "Type restrictions"
    `MsgPackSerializer` only handles basic types: dicts, lists, strings, numbers, booleans, and `None`. It does not support lambdas, closures, or arbitrary Python objects. Use `CloudpickleSerializer` when you need to pass complex objects.

### EncryptedSerializer

AES-256-GCM encryption for task arguments and results. Payloads stored in the database are opaque ciphertext — only the key holder can read them. Requires the `cryptography` package.

```bash
pip install cryptography
```

```python
import os
from taskito.serializers import EncryptedSerializer

queue = Queue(serializer=EncryptedSerializer(key=os.environ["QUEUE_KEY"]))
```

The key must be exactly 32 bytes, base64-encoded. Generate one with:

```bash
python -c "import os, base64; print(base64.b64encode(os.urandom(32)).decode())"
```

By default, `EncryptedSerializer` wraps `CloudpickleSerializer`. To wrap a different serializer:

```python
from taskito.serializers import EncryptedSerializer, MsgPackSerializer

queue = Queue(serializer=EncryptedSerializer(key=key, inner=MsgPackSerializer()))
```

## When to Use Each

| | CloudpickleSerializer | JsonSerializer | MsgPackSerializer | EncryptedSerializer |
|---|---|---|---|---|
| **Complex objects** | Yes | No | No | Depends on inner serializer |
| **Debugging** | Binary payloads (opaque) | Human-readable JSON | Binary (opaque) | Ciphertext (opaque) |
| **Cross-language** | Python only | Any language | Any language | Python only (by default) |
| **Performance** | Good | Good for simple types | Best | Adds encryption overhead |
| **Security** | None | None | None | AES-256-GCM |
| **Extra dependency** | No | No | `msgpack` | `cryptography` |
| **Default** | Yes | No | No | No |

**Rule of thumb**: Use `CloudpickleSerializer` (default) unless you have a specific reason to switch. Use `EncryptedSerializer` when tasks carry sensitive data that must not be readable in the database.

## Custom Serializers

Implement the `Serializer` protocol with two methods:

```python
from taskito import Serializer

class MsgpackSerializer:
    def dumps(self, obj) -> bytes:
        import msgpack
        return msgpack.packb(obj)

    def loads(self, data: bytes):
        import msgpack
        return msgpack.unpackb(data, raw=False)

queue = Queue(serializer=MsgpackSerializer())
```

The protocol requires:

| Method | Signature | Description |
|---|---|---|
| `dumps` | `(obj: Any) -> bytes` | Serialize a Python object to bytes |
| `loads` | `(data: bytes) -> Any` | Deserialize bytes back to a Python object |

The serializer is used for both task arguments (`(args, kwargs)` tuple) and return values.

!!! note "Result deserialization"
    `job.result()` uses the queue's configured serializer for deserialization. If you're using `JsonSerializer` or a custom serializer, results are correctly deserialized with that serializer — not hardcoded cloudpickle.

## Configuration

Pass the serializer to the `Queue` constructor:

```python
queue = Queue(
    db_path="myapp.db",
    serializer=JsonSerializer(),
)
```

All tasks on the queue use the same serializer. The serializer must be consistent between the enqueuing code and the worker — using different serializers will cause deserialization failures.
