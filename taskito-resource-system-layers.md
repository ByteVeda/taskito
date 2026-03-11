# Taskito Resource System — Layer Specification

## Philosophy

Every other task queue treats arguments as "serialize or die" and workers as stateless executors. Taskito treats arguments as objects with intent and workers as resource-aware runtimes. The Resource System is three layers working together — each valuable alone, transformative combined.

---

## Layer 1: Intelligent Interception

### Purpose

The first line of defense. Before a task is ever enqueued, before it touches the store, taskito inspects every argument and makes an informed decision about what to do with it. No other task queue does this — they all blindly try to serialize and throw a traceback on failure.

### Where It Runs

Caller side, inside `delay()` and `apply_async()`, before serialization and before the task payload is written to the store.

### Core Behavior

Every argument passes through the interceptor. The interceptor does one of five things:

1. **PASS** — The argument is natively serializable (int, str, float, bool, None, list, dict, tuple, bytes). Let it through untouched. Zero overhead.

2. **CONVERT** — The argument is nearly serializable but needs a small transformation. Pydantic models become dicts via `.model_dump()`. Dataclasses become dicts via `dataclasses.asdict()`. UUIDs become strings. datetimes become ISO strings. Enums become their values. The original type information is preserved in metadata so the worker can reconstruct the exact type.

3. **PROXY** — The argument is non-serializable but can be meaningfully reconstructed on the worker. File handles, HTTP clients, cloud SDK clients. The interceptor extracts a recipe and substitutes it into the payload. This bridges into Layer 3.

4. **REDIRECT** — The argument is non-serializable and should not be reconstructed from the caller's state. Instead it should come from the worker's own resource pool. Database sessions, Redis connections, connection pools. The interceptor substitutes a DI marker. This bridges into Layer 2.

5. **REJECT** — The argument is non-serializable and cannot be proxied or redirected. Thread locks, sockets, generators, lambdas. The interceptor raises an error immediately with a clear explanation and suggestion.

### Features

#### 1.1 Type Registry

A central registry mapping Python types to interception strategies. This is the brain of the interceptor.

**Structure:**

- Each entry maps a type (or tuple of types) to a strategy (PASS, CONVERT, PROXY, REDIRECT, REJECT)
- Entries have a priority. More specific types take precedence over broader ones. `AsyncSession` matches before `object`.
- The registry is built at queue initialization time from built-in handlers plus user-registered handlers.
- The registry is compiled into an ordered list sorted by specificity. At interception time, it's a linear scan with `isinstance()` checks. For typical registries (20-50 entries), this is microseconds.

**Built-in registry entries:**

Natively serializable (PASS):
- int, float, str, bool, None, bytes
- list, tuple, set, frozenset (recursively checked)
- dict (recursively checked)

Auto-convertible (CONVERT):
- `uuid.UUID` → string, reconstructed via `UUID()`
- `datetime.datetime` → ISO string, reconstructed via `fromisoformat()`
- `datetime.date` → ISO string
- `datetime.time` → ISO string
- `datetime.timedelta` → total seconds float
- `decimal.Decimal` → string, reconstructed via `Decimal()`
- `pathlib.Path` → string, reconstructed via `Path()`
- `enum.Enum` subclasses → value + class reference
- `pydantic.BaseModel` subclasses → `.model_dump()` + class reference
- `dataclasses` → `asdict()` + class reference
- `typing.NamedTuple` → tuple + class reference
- `collections.OrderedDict` → list of pairs
- `re.Pattern` → pattern string + flags

Proxyable (PROXY — bridges to Layer 3):
- `io.TextIOWrapper` (open file handles)
- `io.BufferedReader`, `io.BufferedWriter`
- `requests.Session`
- `httpx.Client`, `httpx.AsyncClient`
- `boto3` service clients
- `google.cloud.storage.Client`, `Blob`, `Bucket`
- `logging.Logger`

Redirectable (REDIRECT — bridges to Layer 2):
- `sqlalchemy.orm.Session`, `sqlalchemy.ext.asyncio.AsyncSession`
- `sqlalchemy.engine.Engine`, `sqlalchemy.ext.asyncio.AsyncEngine`
- `redis.Redis`, `redis.asyncio.Redis`
- `motor.motor_asyncio.AsyncIOMotorClient`
- `psycopg2.connection`, `asyncpg.Connection`
- `pymongo.MongoClient`
- `django.db.connection`
- `aiohttp.ClientSession` (should be worker-owned, not reconstructed)

Rejectable (REJECT — with helpful messages):
- `threading.Lock`, `threading.RLock`, `threading.Semaphore`, `threading.Event`
- `multiprocessing.Lock`, `multiprocessing.Queue`, `multiprocessing.Value`
- `socket.socket`
- `generator` objects, `coroutine` objects
- `lambda` functions (non-named)
- `tempfile.NamedTemporaryFile`, `tempfile.SpooledTemporaryFile`
- `_io.FileIO` on closed files (file already closed, nothing to reconstruct)
- `subprocess.Popen`
- `asyncio.Task`, `asyncio.Future`
- `contextvars.Context`

#### 1.2 Recursive Argument Walking

The interceptor doesn't just check top-level arguments. It walks the entire argument tree.

**What gets walked:**
- Positional args (tuple)
- Keyword args (dict)
- Nested dicts (values and keys)
- Nested lists, tuples, sets (elements)
- Pydantic model fields
- Dataclass fields
- NamedTuple fields
- Custom objects with `__dict__` (configurable, off by default)

**Depth limiting:**
- Default max depth: 10 levels
- Configurable per queue
- Beyond max depth, objects pass through to the serializer as-is
- Circular reference detection via identity set (`id()` tracking)

**Performance:**
- Flat args with 5 simple values: ~5μs
- Nested dict with 100 keys: ~50μs
- Deep nesting (10 levels, 1000 total nodes): ~200μs
- Implemented in Rust for speed. Python fallback available but slower.

#### 1.3 Enhanced Error Messages

When interception results in REJECT, the error message is a first-class feature, not an afterthought.

**Error message structure:**

```
TaskitoSerializationError: Cannot serialize argument '{arg_name}' (type: {type_name})

{One sentence explaining WHY this type can't be sent to a worker.}

Suggestions:
  1. {Primary fix — the most common solution}
  2. {Alternative fix — if applicable}
  3. {Advanced fix — if the user wants to handle it custom}

Docs: https://taskito.dev/resources/{type-specific-guide}
```

**Features of error messages:**
- Argument name is identified (not just type, but which parameter)
- Position in nested structure is shown for deep arguments: `kwargs.config.db_session`
- Suggestion includes a working code snippet, not just a description
- Link to type-specific documentation page
- If multiple arguments fail, all errors are collected and shown together (not one at a time)

#### 1.4 Strict and Lenient Modes

**Strict mode (default):**
- Any REJECT-type argument raises immediately
- Any unknown non-serializable type raises with a generic message
- Safest for production — no silent failures

**Lenient mode:**
- REJECT-type arguments are logged as warnings and dropped from the payload
- Unknown non-serializable types are attempted with the serializer (may or may not work)
- Useful for development and migration from other task queues

**Passthrough mode:**
- Interceptor is completely disabled
- All arguments go directly to the serializer
- Equivalent to Celery/Dramatiq behavior
- Exists for users who don't want the overhead or behavior change

Configured per queue:

```python
queue = Queue(db_path="tasks.db", interception="strict")  # default
queue = Queue(db_path="tasks.db", interception="lenient")
queue = Queue(db_path="tasks.db", interception="off")
```

#### 1.5 Custom Type Registration

Users can register their own types with any strategy:

```python
@queue.register_type(MyCustomClient, strategy="proxy")
class MyClientHandler:
    ...

@queue.register_type(MyDBWrapper, strategy="redirect", resource="db")
class MyDBHandler:
    ...

@queue.register_type(MyInternalLock, strategy="reject",
                      message="Use queue.lock() for distributed locking")
class MyLockHandler:
    ...
```

#### 1.6 Interception Report

For debugging, users can ask taskito to analyze a `delay()` call without actually enqueuing:

```python
report = generate_report.analyze(user_id, session, open("data.csv"))
print(report)

# Output:
# Argument Analysis:
#   arg[0] user_id (int)          → PASS
#   arg[1] session (AsyncSession)  → REDIRECT to worker resource 'db'
#   arg[2] (TextIOWrapper)         → PROXY via FileHandler
#                                    recipe: {path: "data.csv", mode: "r"}
# Estimated payload size: 142 bytes
```

This is invaluable for debugging and for understanding what taskito does with your arguments.

---

## Layer 2: Worker Resource Runtime

### Purpose

Workers are long-lived processes, but every task queue treats them as dumb executors. Taskito gives workers a resource runtime — they declare what resources they own, how to create them, how to check their health, and how to tear them down. Tasks declare what they need, and the worker injects it. This eliminates boilerplate, prevents resource leaks, and enables connection pooling and sharing across tasks.

### Where It Runs

Worker side. Resources are initialized when the worker starts, managed throughout its lifetime, and torn down when it shuts down.

### Features

#### 2.1 Resource Declaration

Two ways to declare resources — decorator and programmatic.

**Decorator style:**

```python
@queue.worker_resource("db")
async def create_db():
    engine = create_async_engine("postgresql+asyncpg://localhost/mydb", pool_size=10)
    return async_sessionmaker(engine)
```

**Programmatic style:**

```python
queue.register_resource(
    name="db",
    factory=create_db_pool,
    teardown=close_db_pool,
    health_check=check_db_health,
    scope="worker",
)
```

**TOML config style (for ops teams):**

```toml
[resources.db]
factory = "myapp.resources:create_db_pool"
teardown = "myapp.resources:close_db_pool"
health_check = "myapp.resources:check_db_health"
scope = "worker"
pool_size = 10
```

All three are equivalent. Decorator is best for application code. Programmatic is best for dynamic configuration. TOML is best for deployment configuration.

#### 2.2 Resource Scopes

**Worker scope:**
- One instance for the entire worker lifetime
- Shared across all tasks and all threads
- Must be thread-safe
- Examples: connection pools, configuration objects, ML models, API clients with connection pooling

**Task scope:**
- Fresh instance per task execution
- Acquired from a pool before the task runs, returned after
- Not shared between concurrent tasks
- Examples: individual DB sessions, temporary directories, request-scoped caches

**Thread scope:**
- One instance per worker thread
- Persists across tasks on the same thread
- Not shared between threads
- Examples: thread-local caches, non-thread-safe clients, compiled regex caches

**Request scope (for long-running tasks):**
- Created when the task starts, destroyed when it ends
- Not pooled — always fresh
- Examples: audit loggers, tracing spans, per-task temp directories

```
Worker Process
├── Worker-scoped resources (shared by all)
│   ├── db_pool (AsyncEngine with pool_size=10)
│   ├── redis (Redis client, thread-safe)
│   └── config (AppConfig, read-only)
│
├── Thread 1
│   ├── Thread-scoped resources
│   │   └── local_cache (LRUCache)
│   └── Running Task A
│       └── Task-scoped resources
│           └── db_session (from pool)
│
├── Thread 2
│   ├── Thread-scoped resources
│   │   └── local_cache (LRUCache)
│   └── Running Task B
│       └── Task-scoped resources
│           └── db_session (from pool)
│
└── Thread 3
    ├── Thread-scoped resources
    │   └── local_cache (LRUCache)
    └── Idle (no task)
```

#### 2.3 Resource Lifecycle

**Initialization phase:**

```
Worker starts
    │
    ▼
Parse resource declarations
    │
    ▼
Build dependency graph
    │
    ▼
Topological sort for initialization order
    │
    ▼
Initialize resources in order:
    │
    ├── config (no deps) ──► create_config()
    │
    ├── db_pool (depends: config) ──► create_db_pool(config)
    │
    ├── redis (depends: config) ──► create_redis(config)
    │
    └── cache (depends: redis) ──► create_cache(redis)
    │
    ▼
All resources ready ──► Worker starts accepting tasks
```

**Execution phase:**

```
Task arrives
    │
    ▼
Check task's declared dependencies
    │
    ▼
For each dependency:
    │
    ├── Worker scope ──► return existing reference
    │
    ├── Task scope ──► acquire from pool (block if exhausted)
    │
    ├── Thread scope ──► return thread-local instance (create if first use)
    │
    └── Request scope ──► create fresh instance
    │
    ▼
Inject all resolved resources into task kwargs
    │
    ▼
Execute task
    │
    ▼
Post-execution cleanup:
    ├── Worker scope ──► no-op (lives on)
    ├── Task scope ──► return to pool
    ├── Thread scope ──► no-op (lives on)
    └── Request scope ──► teardown and destroy
```

**Teardown phase:**

```
Shutdown signal received
    │
    ▼
Stop accepting new tasks
    │
    ▼
Wait for in-flight tasks (configurable timeout)
    │
    ▼
Teardown resources in REVERSE dependency order:
    │
    ├── cache ──► cache.clear(), cache.close()
    │
    ├── redis ──► redis.close()
    │
    ├── db_pool ──► engine.dispose()
    │
    └── config ──► no-op
    │
    ▼
Worker exits cleanly
```

#### 2.4 Dependency Resolution Between Resources

Resources can depend on other resources. A database session factory needs the engine. A cache might need Redis. An API client might need config for credentials.

**Declaration:**

```python
@queue.worker_resource("config")
def create_config():
    return load_config("config.toml")

@queue.worker_resource("db", depends_on=["config"])
def create_db(config):
    return create_async_engine(config.database_url, pool_size=config.pool_size)

@queue.worker_resource("cache", depends_on=["redis", "config"])
def create_cache(redis, config):
    return CacheLayer(redis, ttl=config.cache_ttl)
```

**Dependency injection into resource factories:**
- Factory function receives its dependencies as keyword arguments matching the resource names
- Dependencies are guaranteed to be initialized before the dependent resource
- Circular dependencies detected at registration time, not at startup

**Circular dependency detection:**

```
Registration time:
    db depends on config ──► OK
    cache depends on redis, config ──► OK
    config depends on db ──► ERROR: Circular dependency detected:
                             config → db → config
                             Raised immediately, not at worker startup.
```

#### 2.5 Health Checking

Resources can fail mid-operation. Connections drop. Services restart. Pools exhaust. The worker needs to detect this and recover.

**Health check declaration:**

```python
@queue.worker_resource("db", health_check_interval=30)
def create_db():
    ...

@queue.health_check("db")
async def check_db(db):
    async with db() as session:
        await session.execute(text("SELECT 1"))
```

**Health check behavior:**
- Runs on a background thread/task at the configured interval
- Does not block task execution
- If check fails, resource is marked unhealthy
- Unhealthy resources trigger recreation attempt
- Recreation follows the same factory path as initial creation
- If recreation fails N times (configurable, default 3), worker marks itself degraded

**Degraded worker behavior:**
- Tasks requiring the unhealthy resource are rejected (returned to queue for other workers)
- Tasks not requiring it continue normally
- Health checks continue attempting recreation
- If recreation succeeds, worker returns to healthy state
- If degraded for too long (configurable timeout), worker shuts down

```
Health check runs
    │
    ├── PASS ──► no action, schedule next check
    │
    └── FAIL
        │
        ▼
    Mark resource unhealthy
        │
        ▼
    Attempt recreation (attempt 1/3)
        │
        ├── SUCCESS ──► mark healthy, resume normal operation
        │
        └── FAIL ──► attempt 2/3
            │
            ├── SUCCESS ──► mark healthy
            │
            └── FAIL ──► attempt 3/3
                │
                ├── SUCCESS ──► mark healthy
                │
                └── FAIL ──► mark worker DEGRADED
                    │
                    ▼
                Reject tasks needing this resource
                Continue health checks
                    │
                    ├── Eventually succeeds ──► mark healthy
                    │
                    └── Degraded timeout ──► shutdown worker
```

#### 2.6 Pool Management (Task-scoped Resources)

Task-scoped resources come from a pool. The pool needs proper management.

**Pool configuration:**
- `pool_size`: maximum number of instances (default: worker thread count)
- `pool_min`: minimum instances kept alive (default: 0)
- `acquire_timeout`: how long a task waits for a resource (default: 10s)
- `max_lifetime`: maximum age of an instance before recreation (default: 3600s)
- `idle_timeout`: destroy idle instances after this duration (default: 300s)
- `validation`: optional check before returning an instance from the pool

**Pool behavior:**
- Pre-warm `pool_min` instances at worker startup
- Create new instances on demand up to `pool_size`
- When a task finishes, return the instance to the pool
- If the instance exceeds `max_lifetime`, destroy instead of returning
- Periodically prune instances beyond `pool_min` that have been idle beyond `idle_timeout`
- If `acquire_timeout` expires, task fails with clear error about pool exhaustion

**Pool metrics (exposed via worker stats):**
- Current pool size
- Active (checked out) count
- Idle count
- Wait count (tasks blocked waiting)
- Total acquisitions
- Total timeouts
- Average acquisition time

#### 2.7 Task Dependency Declaration

Tasks declare what resources they need. Multiple declaration styles.

**Decorator parameter:**

```python
@queue.task(inject=["db", "redis"])
async def process_order(order_id: int, db, redis):
    ...
```

**Type annotation (more Pythonic, requires import):**

```python
from taskito import Inject

@queue.task()
async def process_order(order_id: int, db: Inject["db"], redis: Inject["redis"]):
    ...
```

**Both are equivalent. The decorator approach is simpler. The annotation approach is more explicit and works better with type checkers.**

**Validation at registration time:**
- When a task is decorated, taskito checks that the inject names are valid Python identifiers
- At worker startup, taskito cross-references all registered tasks against available resources
- Missing resources produce warnings (not errors) because the worker might not serve all queues
- At task execution time, if a required resource is missing, the task fails immediately with a clear error

#### 2.8 Async and Sync Resource Support

Both sync and async factories, health checks, and teardown functions are supported.

**Detection:** Taskito inspects the factory function with `asyncio.iscoroutinefunction()`. If async, it's awaited. If sync, it's called directly.

**Mixed environments:** A worker can have both sync and async resources. The worker's event loop handles async ones. Sync ones run on the thread pool.

**Async task with sync resource:** Works fine. The sync resource is injected as-is. The task can use it normally (e.g., a sync Redis client used from an async task via `asyncio.to_thread`).

**Sync task with async resource:** The worker resolves the async resource before injecting. The task receives the resolved value, not a coroutine.

#### 2.9 Resource Freezing and Immutability

Worker-scoped resources should not be mutated by tasks. A connection pool's configuration shouldn't change because one task modifies it.

**Optional freeze mechanism:**
- Resources can be declared as `frozen=True`
- Frozen resources are wrapped in a read-only proxy
- Mutation attempts raise `TaskitoResourceError: Cannot modify frozen resource 'config'`
- Not enforced by default (performance cost of proxying), but available for safety-critical setups

#### 2.10 Worker Resource Advertisement

Workers advertise their available resources when they register with the task store.

**Stored in worker heartbeat data:**
```json
{
    "worker_id": "worker-abc123",
    "pid": 42381,
    "resources": ["db", "redis", "config"],
    "resource_health": {
        "db": "healthy",
        "redis": "healthy",
        "config": "healthy"
    },
    "queues": ["default", "priority"],
    "threads": 4,
    "last_heartbeat": "2025-03-10T12:00:00Z"
}
```

**Visible via CLI and API:**

```bash
taskito workers --app myapp:queue

# Output:
# WORKER          PID    THREADS  RESOURCES              HEALTH    QUEUES
# worker-abc123   42381  4        db, redis, config      healthy   default, priority
# worker-def456   42382  2        db, config             degraded  default
#                                                        (redis: unhealthy)
```

**Visible in the web dashboard** as a resource health panel per worker.

#### 2.11 Graceful Shutdown Semantics

When a worker receives SIGTERM or SIGINT:

```
Signal received
    │
    ▼
Set worker state to DRAINING
    │
    ▼
Stop polling for new tasks
    │
    ▼
Wait for in-flight tasks (up to graceful_timeout, default 30s)
    │
    ├── All tasks finish in time
    │   │
    │   ▼
    │   Return all task-scoped resources to pools
    │   │
    │   ▼
    │   Teardown all resources (reverse dependency order)
    │   │
    │   ▼
    │   Worker exits with code 0
    │
    └── Timeout expires with tasks still running
        │
        ▼
    Send cooperative cancellation to running tasks
        │
        ▼
    Wait additional force_timeout (default 5s)
        │
        ├── Tasks respond to cancellation
        │   │
        │   ▼
        │   Cleanup and teardown as above
        │
        └── Tasks still running after force_timeout
            │
            ▼
        Log warning about orphaned tasks
            │
            ▼
        Force teardown resources (best effort)
            │
            ▼
        Worker exits with code 1
```

#### 2.12 Hot Reload

Workers can reload resource configuration without full restart.

**Trigger:** SIGHUP signal, CLI command `taskito reload --app myapp:queue`, or API call.

**Behavior:**
- Worker finishes current in-flight tasks
- Tears down specified resources
- Re-imports the resource factory module (picks up code changes)
- Re-initializes the resources
- Resumes accepting tasks
- In-flight tasks that started before reload continue with old resource instances
- New tasks get new instances

**Scope:** Only reloads resources explicitly marked as `reloadable=True`. By default, resources are not reloadable (safety).

---

## Layer 3: Resource Proxies (Transparent Reconstruction)

### Purpose

For objects that CAN be meaningfully reconstructed on the worker — file handles, HTTP clients, cloud SDK clients — taskito does it automatically. The user passes the object, taskito extracts a recipe, sends it, and reconstructs on the other side. The task function receives what looks like the original object.

### Where It Runs

Both sides. Deconstruction on the caller side (inside `delay()`). Reconstruction on the worker side (before calling the task function). Cleanup on the worker side (after the task completes).

### Features

#### 3.1 Proxy Handler Interface

Every proxyable type has a handler that implements four methods:

**detect(obj):** Returns True if this handler can proxy this object. Usually a simple `isinstance` check, but can be more nuanced (e.g., only proxy open file handles, not closed ones).

**deconstruct(obj):** Extracts a recipe dict from the live object. Recipe must contain only JSON-serializable primitives. This runs on the caller side.

**reconstruct(recipe):** Rebuilds the object from the recipe. This runs on the worker side. May be sync or async.

**cleanup(obj):** Called after the task completes (success or failure). Closes files, releases connections. Optional — defaults to no-op.

#### 3.2 Recipe Versioning

Recipes include a version number. As handlers evolve, old recipe formats must remain readable.

**Rules:**
- Version starts at 1 for each handler
- Adding optional fields to a recipe: no version bump (backward compatible)
- Removing or renaming fields: version bump
- Changing field semantics: version bump
- Handlers must support all previous versions

**Version dispatch:**

```
reconstruct(recipe, version):
    if version == 1:
        return reconstruct_v1(recipe)
    elif version == 2:
        return reconstruct_v2(recipe)
    else:
        raise RecipeVersionError(
            f"FileHandler does not support recipe version {version}. "
            f"Supported: 1-2. Upgrade worker to taskito >= X.Y"
        )
```

**Migration helpers:** Handlers can provide a `migrate(recipe, from_version, to_version)` method that transforms old recipes to new format. This runs before reconstruction and avoids duplicating logic across version-specific reconstruct methods.

#### 3.3 Recipe Integrity and Security

Recipes are signed to prevent tampering.

**Signing:**
- Each recipe includes an HMAC-SHA256 checksum
- Computed over: handler name + version + canonical JSON of recipe data
- Key: configurable secret (environment variable, config file, or derived from queue config)
- Computed in Rust for performance

**Validation on worker side:**
- Before any reconstruction, checksum is verified
- Invalid checksum: recipe is rejected, task is failed with security error, event is logged
- Missing checksum (legacy payload): configurable — reject (strict) or warn and proceed (lenient)

**Schema enforcement:**
- Each handler declares the exact set of allowed keys and their types
- Extra keys in a recipe: rejected
- Wrong types: rejected
- This prevents injection attacks where a malicious recipe includes unexpected fields

**Path restrictions (for file handler):**
- Configurable allowlist of base directories
- `/shared/data/input.csv` with allowlist `["/shared/"]`: allowed
- `/etc/passwd` with allowlist `["/shared/"]`: rejected
- `/shared/../etc/passwd` (path traversal): normalized and rejected

#### 3.4 Built-in Proxy Handlers

**FileHandler:**
- Detects: `io.TextIOWrapper`, `io.BufferedReader`, `io.BufferedWriter`, `io.FileIO`
- Recipe: `{path, mode, encoding, position, buffering}`
- Reconstruct: `open(path, mode, encoding=encoding)` then `seek(position)`
- Cleanup: `file.close()`
- Rejects: closed files (nothing to reconstruct), stdin/stdout/stderr (not real files), pipes
- Security: path allowlist enforcement

**PathHandler:**
- Detects: `pathlib.Path`, `pathlib.PurePath`
- Recipe: `{path_string}`
- This is technically a CONVERT, not a full proxy — just string conversion with type preservation
- Reconstruct: `Path(path_string)`
- Cleanup: none

**RequestsSessionHandler:**
- Detects: `requests.Session`
- Recipe: `{headers, cookies, auth_type, base_url, max_redirects, verify}`
- Reconstruct: create new Session, apply config
- Does NOT preserve connection pool state (that's process-local)
- Cleanup: `session.close()`

**HttpxClientHandler:**
- Detects: `httpx.Client`, `httpx.AsyncClient`
- Recipe: `{headers, cookies, base_url, timeout, follow_redirects, verify}`
- Reconstruct: create new client with config
- Cleanup: `client.close()` or `await client.aclose()`

**Boto3ClientHandler:**
- Detects: boto3 service clients (S3, SQS, DynamoDB, etc.)
- Recipe: `{service_name, region_name, endpoint_url, config_options}`
- Reconstruct: `boto3.client(service_name, region_name=region_name, ...)`
- Does NOT capture credentials in recipe (security). Uses worker's ambient credentials.
- Cleanup: none (boto3 clients manage their own connection lifecycle)

**GCSClientHandler:**
- Detects: `google.cloud.storage.Client`, `Bucket`, `Blob`
- Recipe for Client: `{project}`
- Recipe for Bucket: `{project, bucket_name}`
- Recipe for Blob: `{project, bucket_name, blob_name}`
- Reconstruct: rebuild the chain from Client down to Blob
- Uses worker's ambient credentials (GOOGLE_APPLICATION_CREDENTIALS)
- Cleanup: none

**LoggerHandler:**
- Detects: `logging.Logger`
- Recipe: `{name, level}`
- Reconstruct: `logging.getLogger(name)` with level set
- Cleanup: none

**PydanticModelHandler:**
- Detects: `pydantic.BaseModel` subclasses
- Recipe: `{model_class_path, data}`
- Deconstruct: `model.model_dump(mode="json")` + fully qualified class name
- Reconstruct: import class, call `model_class.model_validate(data)`
- Cleanup: none
- This is a CONVERT strategy, not a full proxy

**DataclassHandler:**
- Detects: objects where `dataclasses.is_dataclass(obj)` is True
- Recipe: `{class_path, fields}`
- Deconstruct: `dataclasses.asdict(obj)` + fully qualified class name
- Reconstruct: import class, call `class(**fields)`
- Cleanup: none

#### 3.5 Identity Tracking

When the same object is passed in multiple argument positions, it should be deconstructed once and reconstructed once.

**How it works:**
- The interceptor assigns each proxied object an identity UUID
- Tracked by Python `id()` during the intercept pass
- If `id(arg_a) == id(arg_b)`, they share the same identity UUID
- In the payload, the first occurrence carries the full recipe. Subsequent occurrences carry just `{"__taskito_ref__": "<identity_uuid>"}`
- On reconstruction, the first occurrence is reconstructed. Subsequent references resolve to the same instance.

**Why it matters:**
- Avoids double-opening files, double-creating clients
- Preserves the caller's intent that both arguments point to the same object
- Saves payload space

#### 3.6 Reconstruction Timeout

Reconstruction is external code and could hang (network call, DNS resolution, slow filesystem).

**Behavior:**
- Each reconstruction call is wrapped in a timeout (configurable, default 10s)
- If timeout expires: `ResourceReconstructionError: Reconstruction of 'file' timed out after 10s`
- Task fails normally, retry/failure hooks fire
- The timeout is enforced at the Rust level for reliability (Python-level timeouts can be bypassed by C extensions)

#### 3.7 Reconstruction Performance Monitoring

Taskito tracks reconstruction times per handler and warns about slow patterns.

**Metrics collected:**
- Per-handler: average reconstruction time, p95, p99, max
- Per-task: total reconstruction overhead
- Exposed via `queue.stats()`, CLI `taskito info`, and the web dashboard

**Automatic warnings:**
- If a handler's average reconstruction time exceeds 1s: log a warning suggesting DI instead
- If a single reconstruction exceeds 5s: log a warning on that specific task
- Warnings include actionable guidance: "FileHandler averaged 2.3s reconstruction. Consider using a worker resource for frequently accessed files."

#### 3.8 Conditional Proxying

Not every instance of a type should be proxied. Users can add conditions.

**Handler-level conditions:**
- FileHandler only proxies open files (not closed)
- FileHandler only proxies real files (not stdin/stdout/stderr/pipes)
- Boto3Handler only proxies if the service is in an allowlist

**User-level overrides:**
- Users can disable specific handlers: `queue = Queue(..., disabled_proxies=["file", "boto3"])`
- Users can force passthrough for specific arguments: `task.delay(NoProxy(my_object))`
- `NoProxy` wrapper tells the interceptor to skip this argument entirely

#### 3.9 Cleanup Guarantees

Reconstructed resources must be cleaned up, even if the task fails.

**Cleanup execution order:**

```
Task execution
    │
    ├── SUCCESS
    │   │
    │   ▼
    │   Run cleanup for all reconstructed resources (LIFO order)
    │
    ├── FAILURE (exception)
    │   │
    │   ▼
    │   Run cleanup for all reconstructed resources (LIFO order)
    │   (cleanup runs even though task failed)
    │
    ├── CANCELLED
    │   │
    │   ▼
    │   Run cleanup for all reconstructed resources (LIFO order)
    │
    └── TIMEOUT
        │
        ▼
        Run cleanup for all reconstructed resources (LIFO order)
        (best-effort, may not complete if process is being killed)
```

**Cleanup failure handling:**
- Cleanup errors are caught and logged, never propagated
- Cleanup failure does NOT change the task's result status
- If cleanup consistently fails for a handler, metrics track this

**LIFO order:** Resources are cleaned up in reverse order of reconstruction. Last opened, first closed. This matches Python's context manager convention and avoids dependency issues.

---

## Layer Interaction Diagram

```
User calls: generate_report.delay(user_id, db_session, open("data.csv"), config)
    │
    ▼
╔═══════════════════════════════════════════════════════════╗
║  LAYER 1: Intelligent Interception                        ║
║                                                           ║
║  arg[0] user_id (int)         → PASS (natively serializable)
║  arg[1] db_session (AsyncSession) → REDIRECT (DI marker for "db")
║  arg[2] file (TextIOWrapper)  → PROXY (recipe via FileHandler)
║  arg[3] config (AppConfig)    → CONVERT (Pydantic .model_dump())
║                                                           ║
║  Result: clean payload with markers and recipes           ║
╚═══════════════════════════════════════════════════════════╝
    │
    ▼
Serialized and stored in task store (SQLite/PG)
    │
    ▼
Worker picks up task
    │
    ▼
╔═══════════════════════════════════════════════════════════╗
║  LAYER 3: Resource Proxies                                ║
║                                                           ║
║  Scan payload for proxy markers                           ║
║  file recipe found → validate checksum → reconstruct      ║
║    → open("/shared/data.csv", "r") → seek(0)             ║
║  config recipe found → validate → reconstruct             ║
║    → AppConfig.model_validate(data)                       ║
║  Register both for post-task cleanup                      ║
╚═══════════════════════════════════════════════════════════╝
    │
    ▼
╔═══════════════════════════════════════════════════════════╗
║  LAYER 2: Worker Resource Runtime                         ║
║                                                           ║
║  DI marker for "db" found                                 ║
║  → Look up "db" in worker resource registry               ║
║  → Acquire session factory (worker-scoped)                ║
║  → Inject into kwargs as 'db'                             ║
╚═══════════════════════════════════════════════════════════╝
    │
    ▼
Task function called with:
    generate_report(
        user_id=42,                          # original int
        db=<worker's sessionmaker>,          # injected by Layer 2
        file=<reconstructed file handle>,    # rebuilt by Layer 3
        config=<reconstructed AppConfig>,    # rebuilt by Layer 3
    )
    │
    ▼
Task completes (success or failure)
    │
    ▼
╔═══════════════════════════════════════════════════════════╗
║  CLEANUP                                                  ║
║                                                           ║
║  Layer 3 cleanup (LIFO):                                  ║
║    config → no-op (Pydantic model, nothing to close)      ║
║    file   → file.close()                                  ║
║                                                           ║
║  Layer 2 cleanup:                                         ║
║    db → no-op (worker-scoped, lives on)                   ║
╚═══════════════════════════════════════════════════════════╝
```

---

## Configuration Reference

### Queue-Level Configuration

```python
queue = Queue(
    db_path="tasks.db",

    # Layer 1
    interception="strict",           # "strict" | "lenient" | "off"
    max_intercept_depth=10,          # recursive walk depth limit
    disabled_proxies=["boto3"],      # disable specific proxy handlers

    # Layer 3
    recipe_signing_key="secret",     # or via env: TASKITO_RECIPE_SECRET
    recipe_validation="strict",      # "strict" | "warn" | "off"
    file_path_allowlist=["/shared/", "/data/"],
    max_reconstruction_timeout=10,   # seconds
)
```

### Worker-Level Configuration

```python
# Via CLI
taskito worker --app myapp:queue \
    --threads 4 \
    --graceful-timeout 30 \
    --health-check-interval 30 \
    --resource-startup strict

# Via TOML
[worker]
threads = 4
graceful_timeout = 30
health_check_interval = 30
resource_startup = "strict"     # "strict" | "lenient"
```

### Per-Resource Configuration

```python
@queue.worker_resource(
    "db",
    scope="worker",                # "worker" | "task" | "thread" | "request"
    depends_on=["config"],
    health_check_interval=30,      # seconds, 0 to disable
    max_recreation_attempts=3,
    reloadable=False,
    frozen=False,
    # Pool options (task scope only)
    pool_size=10,
    pool_min=2,
    acquire_timeout=10,
    max_lifetime=3600,
    idle_timeout=300,
)
async def create_db(config):
    ...
```

---

## Observability

### Metrics Exposed

**Resource runtime metrics:**
- `taskito_resource_init_duration_seconds` — time to initialize each resource
- `taskito_resource_health_status` — current health per resource (healthy/unhealthy/degraded)
- `taskito_resource_health_check_duration_seconds` — health check latency
- `taskito_resource_recreation_total` — count of resource recreations
- `taskito_resource_pool_size` — current pool size (task-scoped resources)
- `taskito_resource_pool_active` — checked-out instances
- `taskito_resource_pool_idle` — idle instances
- `taskito_resource_pool_wait_total` — tasks that had to wait for pool
- `taskito_resource_pool_timeout_total` — tasks that timed out waiting for pool
- `taskito_resource_acquire_duration_seconds` — pool acquisition latency

**Interception metrics:**
- `taskito_intercept_duration_seconds` — time spent in argument interception per task
- `taskito_intercept_strategy_total` — count per strategy (pass/convert/proxy/redirect/reject)
- `taskito_intercept_depth_max` — maximum depth reached during recursive walk

**Proxy metrics:**
- `taskito_proxy_reconstruct_duration_seconds` — reconstruction time per handler
- `taskito_proxy_reconstruct_total` — total reconstructions per handler
- `taskito_proxy_reconstruct_errors_total` — failed reconstructions per handler
- `taskito_proxy_cleanup_errors_total` — failed cleanups per handler
- `taskito_proxy_checksum_failures_total` — integrity check failures (security metric)
- `taskito_proxy_payload_overhead_bytes` — additional payload size from recipes

### CLI Visibility

```bash
taskito info --app myapp:queue --resources

# Output:
# RESOURCE    SCOPE    HEALTH    POOL (active/idle/max)    RECREATIONS
# db          worker   healthy   -                         0
# redis       worker   healthy   -                         1
# db_session  task     healthy   3/7/10                    0
# config      worker   healthy   -                         0
#
# PROXY HANDLERS    RECONSTRUCTIONS    AVG TIME    ERRORS
# file              142                1.2ms       0
# requests          37                 3.8ms       2
# pydantic          891                0.1ms       0
```

### Dashboard Integration

The existing taskito web dashboard gains a new "Resources" tab showing:
- Worker resource health per worker (real-time)
- Pool utilization graphs (time series)
- Interception strategy breakdown (pie chart per task type)
- Proxy reconstruction latency (histogram per handler)
- Security events (checksum failures, path violations)

---

## Testing Support

### Test Mode Behavior

In `queue.test_mode()`, tasks run synchronously in the same process. The resource system adapts:

**Layer 1 (Interception):** Still runs. Catches errors early even in tests. But REDIRECT strategy in test mode can optionally inject test doubles instead of requiring a full worker resource setup.

**Layer 2 (DI):** Test mode supports resource overrides:

```python
def test_process_order():
    mock_db = MockSessionMaker()
    with queue.test_mode(resources={"db": mock_db}) as results:
        process_order.delay(42)
        assert results[0].return_value == expected
```

**Layer 3 (Proxies):** In test mode, proxy reconstruction is skipped. Since caller and executor are the same process, the original object is passed through directly. No recipe extraction, no reconstruction, no cleanup lifecycle. The interceptor still runs type detection to catch potential issues, but it doesn't transform the arguments.

### Resource Mocking

```python
from taskito.testing import MockResource

# Complete mock
mock_redis = MockResource("redis", return_value=FakeRedis())

# Spy (wraps real resource, tracks calls)
spy_db = MockResource("db", wraps=real_db, track_calls=True)

with queue.test_mode(resources={"redis": mock_redis, "db": spy_db}):
    my_task.delay(data)
    assert spy_db.call_count == 1
```
