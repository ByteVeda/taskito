# Argument Interception

Argument interception classifies every value passed to `.delay()` or `.apply_async()` before serialization. Enable it on the `Queue` constructor:

```python
queue = Queue(db_path="tasks.db", interception="strict")
```

Without interception, values are passed directly to the serializer. A SQLAlchemy session or file handle would either raise a serialization error at enqueue time or produce a broken payload that fails on the worker.

## Modes

| Mode | Behavior |
|---|---|
| `"off"` | Disabled (default). All arguments pass through to the serializer unchanged. |
| `"strict"` | Raises `InterceptionError` immediately when a rejected type is detected. |
| `"lenient"` | Logs a warning and drops the rejected argument instead of raising. |

`"strict"` is recommended for production — it surfaces problems at call time rather than causing silent task failures.

## Classification strategies

Every argument gets one of five strategies:

| Strategy | What happens | Examples |
|---|---|---|
| `PASS` | Sent as-is to the serializer | `int`, `str`, `bool`, `bytes` |
| `CONVERT` | Transformed to a serializable form, reconstructed on the worker | `UUID`, `datetime`, `Decimal`, `Path`, `Enum`, Pydantic models, dataclasses |
| `REDIRECT` | Replaced with a DI marker; the worker injects the named resource | SQLAlchemy sessions, Redis clients, MongoDB clients |
| `PROXY` | Deconstructed to a recipe; reconstructed as a live object on the worker | File handles, loggers, `requests.Session`, `httpx.Client`, boto3 clients |
| `REJECT` | Raises `InterceptionError` in strict mode, dropped in lenient mode | Thread locks, generators, coroutines, sockets |

## Built-in CONVERT types

These are converted automatically when interception is enabled:

| Type | Notes |
|---|---|
| `uuid.UUID` | Stored as `"uuid:<hex>"` |
| `datetime.datetime` / `date` / `time` / `timedelta` | ISO format |
| `decimal.Decimal` | Stored as string to preserve precision |
| `pathlib.Path` / `PurePath` | Stored as POSIX string |
| `re.Pattern` | Pattern string + flags |
| `collections.OrderedDict` | Preserves insertion order |
| `pydantic.BaseModel` | Via `.model_dump()` (if pydantic is installed) |
| `enum.Enum` subclasses | Class path + value |
| Dataclasses | Auto-detected via `dataclasses.is_dataclass()` |
| `NamedTuple` subclasses | Auto-detected |

## Built-in REDIRECT types

These connectors are automatically detected and replaced with a resource injection marker. The worker injects the named resource instead of attempting to deserialize a live connection object:

| Type | Default resource name |
|---|---|
| `sqlalchemy.orm.Session` | `"db"` |
| `sqlalchemy.ext.asyncio.AsyncSession` | `"db"` |
| `sqlalchemy.engine.Engine` | `"db"` |
| `sqlalchemy.ext.asyncio.AsyncEngine` | `"db"` |
| `redis.Redis` | `"redis"` |
| `redis.asyncio.Redis` | `"redis"` |
| `pymongo.MongoClient` | `"mongo"` |
| `motor.motor_asyncio.AsyncIOMotorClient` | `"mongo"` |
| `psycopg2.extensions.connection` | `"db"` |
| `asyncpg.connection.Connection` | `"db"` |
| `django.db.backends.base.base.BaseDatabaseWrapper` | `"db"` |
| `aiohttp.ClientSession` | `"aiohttp_session"` |

The resource name is the key you use in `@queue.worker_resource("name")`. If your resource has a different name, register a custom redirect with `register_type()`.

## Built-in PROXY types

These objects are deconstructed to a recipe dict and rebuilt by the worker:

| Type | Handler name |
|---|---|
| `io.TextIOWrapper`, `io.BufferedReader`, `io.BufferedWriter`, `io.FileIO` | `"file"` |
| `logging.Logger` | `"logger"` |
| `requests.Session` | `"requests_session"` |
| `httpx.Client` / `httpx.AsyncClient` | `"httpx_client"` |
| boto3 clients (via `botocore.client.BaseClient`) | `"boto3_client"` |
| `google.cloud.storage.Client` / `Bucket` / `Blob` | `"gcs_client"` |

See [Resource Proxies](proxies.md) for security options and handler details.

## Built-in REJECT types

These are always rejected because they cannot cross process or serialization boundaries:

- Thread synchronization primitives (`Lock`, `RLock`, `Semaphore`, `Event`)
- `socket.socket`
- Generator objects
- Coroutine objects
- `subprocess.Popen`
- `asyncio.Task` / `asyncio.Future`
- `contextvars.Context`
- Multiprocessing `Lock` and `Queue`

Each rejection includes a message explaining why and suggests alternatives.

## Registering custom types

Add custom rules for types not covered by the built-ins:

```python
from myapp import MyDBClient, MoneyAmount, APIConnection

# Treat a custom DB client as a worker resource (worker must have "my_db" registered)
queue.register_type(MyDBClient, "redirect", resource="my_db")

# Convert a custom value type to something serializable
queue.register_type(
    MoneyAmount,
    "convert",
    converter=lambda m: {"__type__": "money", "value": str(m.value), "currency": m.currency},
    type_key="money",
)

# Reject with a helpful message
queue.register_type(
    APIConnection,
    "reject",
    message="API connections are process-local. Register it as a worker resource instead.",
)
```

`register_type()` requires interception to be enabled (`"strict"` or `"lenient"`). Calling it when interception is `"off"` raises `RuntimeError`.

| Parameter | Description |
|---|---|
| `python_type` | The type to register. |
| `strategy` | `"pass"`, `"convert"`, `"redirect"`, `"reject"`, or `"proxy"`. |
| `resource` | Resource name for `"redirect"`. |
| `message` | Rejection reason for `"reject"`. |
| `converter` | Converter callable for `"convert"`. |
| `type_key` | Dispatch key for the converter reconstructor. |
| `proxy_handler` | Handler name for `"proxy"`. |

## Constructor parameters

| Parameter | Default | Description |
|---|---|---|
| `interception` | `"off"` | Interception mode: `"strict"`, `"lenient"`, or `"off"`. |
| `max_intercept_depth` | `10` | Maximum depth the walker recurses into nested containers. |

## Analyzing arguments

Inspect how interception would classify arguments without actually transforming them:

```python
from myapp.tasks import queue

report = queue._interceptor.analyze(
    args=(user_session, "Hello"),
    kwargs={"attachment": open("file.pdf", "rb")},
)
print(report)
# Argument Analysis:
#   args[0]            (Session)              → REDIRECT (redirect to worker resource 'db')
#   args[1]            (str)                  → PASS
#   kwargs.attachment  (BufferedReader)        → PROXY (handler=file)
```

`analyze()` is a development and debugging tool. It reads the registry but makes no changes to arguments.

## Interception metrics

```python
stats = queue.interception_stats()
# {
#   "total_intercepts": 1200,
#   "total_duration_ms": 216.0,
#   "avg_duration_ms": 0.18,
#   "strategy_counts": {"pass": 2800, "convert": 450, "redirect": 200, "proxy": 30, "reject": 0},
#   "max_depth_reached": 3,
# }
```

See [Observability](observability.md) for Prometheus metrics and dashboard endpoints.
