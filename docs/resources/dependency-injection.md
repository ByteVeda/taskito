# Dependency Injection

Worker resources are long-lived objects initialized once at worker startup and injected into tasks by name. No serialization is involved — they live entirely in the worker process and are never put in the queue.

## Declaring resources

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

@queue.worker_resource("db")
def create_db():
    engine = create_engine("postgresql://localhost/myapp")
    return sessionmaker(engine)
```

The factory runs once when the worker starts. The return value is the resource instance.

The factory can be async:

```python
@queue.worker_resource("redis")
async def create_redis():
    import redis.asyncio as aioredis
    return await aioredis.from_url("redis://localhost")
```

Taskito runs the async factory on the worker's event loop before accepting tasks.

## `worker_resource()` parameters

| Parameter | Default | Description |
|---|---|---|
| `name` | required | Resource name used in `inject=["name"]` and `Inject["name"]`. |
| `depends_on` | `[]` | Names of resources this factory receives as arguments. |
| `teardown` | `None` | Callable invoked with the instance on graceful shutdown. |
| `health_check` | `None` | Callable invoked periodically; returns truthy if healthy. |
| `health_check_interval` | `0.0` | Seconds between health checks. `0` disables checking. |
| `max_recreation_attempts` | `3` | Max times to recreate after consecutive health failures. |
| `scope` | `"worker"` | Lifetime scope — see [Resource scopes](#resource-scopes). |
| `pool_size` | `None` | Task scope: max concurrent instances (default: 4). |
| `pool_min` | `0` | Task scope: pre-warmed instances at startup. |
| `acquire_timeout` | `10.0` | Task scope: seconds to wait for an available instance. |
| `max_lifetime` | `3600.0` | Task scope: max seconds an instance can live. |
| `idle_timeout` | `300.0` | Task scope: max idle seconds before eviction. |
| `reloadable` | `False` | Allow hot reload via SIGHUP or CLI. |
| `frozen` | `False` | Wrap instance in a read-only proxy. |

## Injecting resources into tasks

=== "inject= parameter"

    ```python
    @queue.task(inject=["db"])
    def process_order(order_id: int, db):
        session = db()
        order = session.get(Order, order_id)
        ...
    ```

=== "Inject annotation"

    ```python
    from taskito import Inject

    @queue.task()
    def process_order(order_id: int, db: Inject["db"]):
        session = db()
        order = session.get(Order, order_id)
        ...
    ```

Both syntaxes are equivalent. `Inject["name"]` is a type annotation — it works with any type checker and makes the dependency explicit in the function signature. The worker reads the annotation at task registration time and injects the resource automatically.

If a caller explicitly passes a `db` kwarg to `.delay()`, that value wins over injection.

## Resource scopes

| Scope | Lifetime | Use case |
|---|---|---|
| `"worker"` (default) | Entire worker process | Database connection pools, shared caches |
| `"task"` | Acquired per-task from a pool, returned after | Short-lived connections with limited concurrency |
| `"thread"` | One instance per worker thread, created lazily | Thread-unsafe objects that must not be shared |
| `"request"` | Fresh instance per task, torn down after | Stateful per-request objects |

```python
# Task scope: each task gets its own session from a pool of up to 10
@queue.worker_resource("db_session", scope="task", pool_size=10)
def create_session(db):
    return db()  # db must be a worker-scoped resource

# Thread scope: one cache per worker thread
@queue.worker_resource("local_cache", scope="thread")
def create_cache():
    return {}
```

Pool configuration parameters (`pool_size`, `pool_min`, `acquire_timeout`, `max_lifetime`, `idle_timeout`) only apply to task-scoped resources. See [Configuration](configuration.md#pool-configuration) for details.

## Dependencies

Resources can declare other resources they depend on. Taskito resolves the dependency graph and initializes in topological order, injecting dependencies as keyword arguments to the factory:

```python
@queue.worker_resource("config")
def load_config():
    return Config.from_env()


@queue.worker_resource("db", depends_on=["config"])
def create_db(config):
    return create_engine(config.db_url, pool_size=10)


@queue.worker_resource("cache", depends_on=["config"])
def create_cache(config):
    return Redis.from_url(config.redis_url)
```

On shutdown, resources are torn down in reverse initialization order — `cache` and `db` before `config`.

Cycles are detected eagerly at registration time and raise `CircularDependencyError`.

## Teardown

Supply a teardown callable to clean up the resource on graceful shutdown:

```python
@queue.worker_resource(
    "db",
    teardown=lambda engine: engine.dispose(),
)
def create_db():
    return create_engine("postgresql://localhost/myapp")
```

Or use `register_resource()` for the programmatic API:

```python
from taskito.resources.definition import ResourceDefinition

queue.register_resource(ResourceDefinition(
    name="db",
    factory=create_db,
    teardown=close_db,
    depends_on=["config"],
))
```

Teardown callables can be async — Taskito awaits them if they return a coroutine.

## Health checking

Resources can declare a health check function that runs on a background thread. If the check returns falsy, the worker attempts to recreate the resource:

```python
def check_db(engine):
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return True


@queue.worker_resource(
    "db",
    health_check=check_db,
    health_check_interval=30.0,   # check every 30 seconds
    max_recreation_attempts=3,    # mark permanently unhealthy after 3 failures
)
def create_db():
    return create_engine("postgresql://localhost/myapp")
```

The health checker runs in a single daemon thread. Each resource with a non-zero `health_check_interval` is checked independently on its own schedule.

Run a health check manually from application code:

```python
is_healthy = queue.health_check("db")
```

If a resource fails all recreation attempts, it is marked permanently unhealthy. Subsequent tasks that depend on it raise `ResourceUnavailableError`.

## Resource status

```python
status = queue.resource_status()
# [
#   {
#     "name": "config",
#     "scope": "worker",
#     "health": "healthy",
#     "init_duration_ms": 12.4,
#     "recreations": 0,
#     "depends_on": [],
#   },
#   {
#     "name": "db",
#     "scope": "worker",
#     "health": "healthy",
#     "init_duration_ms": 45.2,
#     "recreations": 0,
#     "depends_on": ["config"],
#   },
# ]
```

Task-scoped resources include a `"pool"` key with pool statistics. See [Observability](observability.md) for details.

## Full example

```python
from taskito import Queue, Inject
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session

queue = Queue(db_path="tasks.db", interception="strict")


@queue.worker_resource("config")
def load_config():
    return Config.from_env()


def check_db(engine):
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return True


@queue.worker_resource(
    "db",
    depends_on=["config"],
    teardown=lambda engine: engine.dispose(),
    health_check=check_db,
    health_check_interval=60.0,
)
def create_db(config):
    return create_engine(config.database_url, pool_size=10)


@queue.task()
def process_order(order_id: int, db: Inject["db"]):
    session: Session = db()
    try:
        order = session.get(Order, order_id)
        order.status = "processed"
        session.commit()
    finally:
        session.close()
```
