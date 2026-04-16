# Serialization

taskito uses a pluggable serializer for task arguments and results. The default is `CloudpickleSerializer`, which supports lambdas, closures, and complex Python objects.

```python
from taskito import Queue, JsonSerializer

# Use JSON for simpler, cross-language payloads
queue = Queue(serializer=JsonSerializer())
```

## Built-in serializers

| Serializer | Format | Best for |
|---|---|---|
| `CloudpickleSerializer` (default) | Binary (pickle) | Complex Python objects, lambdas, closures |
| `JsonSerializer` | JSON | Simple types, cross-language interop, debugging |

## Custom serializers

Implement the `Serializer` protocol (`dumps(obj) -> bytes`, `loads(data) -> Any`).

## What gets serialized

- **Arguments**: `serializer.dumps((args, kwargs))` — stored as BLOB in `payload`
- **Results**: `serializer.dumps(return_value)` — stored as BLOB in `result`
- **Periodic task args**: Serialized at registration time, stored as BLOBs in `periodic_tasks.args`
