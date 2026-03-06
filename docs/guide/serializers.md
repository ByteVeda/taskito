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

## When to Use Each

| | CloudpickleSerializer | JsonSerializer |
|---|---|---|
| **Complex objects** | Yes (lambdas, closures, classes) | No (simple types only) |
| **Debugging** | Binary payloads (opaque) | Human-readable JSON |
| **Cross-language** | Python only | Any language |
| **Performance** | Slightly faster for complex objects | Slightly faster for simple types |
| **Default** | Yes | No |

**Rule of thumb**: Use `CloudpickleSerializer` (default) unless you have a specific reason to use JSON.

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

## Configuration

Pass the serializer to the `Queue` constructor:

```python
queue = Queue(
    db_path="myapp.db",
    serializer=JsonSerializer(),
)
```

All tasks on the queue use the same serializer. The serializer must be consistent between the enqueuing code and the worker — using different serializers will cause deserialization failures.
