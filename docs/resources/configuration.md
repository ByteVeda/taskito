# Configuration

Resources can be declared in code with `@queue.worker_resource()` or loaded from a TOML file. Both approaches support the same options.

## TOML configuration file

Define resources in a TOML file and load them at startup:

```toml
# resources.toml

[resources.config]
factory = "myapp.resources:load_config"
scope = "worker"

[resources.db]
factory = "myapp.resources:create_engine"
teardown = "myapp.resources:close_engine"
health_check = "myapp.resources:check_db"
health_check_interval = 30.0
max_recreation_attempts = 3
scope = "worker"
depends_on = ["config"]

[resources.session]
factory = "myapp.resources:create_session"
scope = "task"
pool_size = 20
pool_min = 5
acquire_timeout = 5.0
depends_on = ["db"]
```

Load before starting the worker:

```python
queue.load_resources("resources.toml")
```

The `factory`, `teardown`, and `health_check` values are import paths. Both formats are accepted:

- `"myapp.resources:create_engine"` — colon separator (preferred)
- `"myapp.resources.create_engine"` — dot separator

On Python 3.11+ the TOML parser is built-in. On earlier versions, install `tomli`:

```bash
pip install tomli
```

## TOML resource options

| Key | Type | Default | Description |
|---|---|---|---|
| `factory` | string | required | Import path to the factory callable. |
| `teardown` | string | — | Import path to the teardown callable. |
| `health_check` | string | — | Import path to the health check callable. |
| `health_check_interval` | float | `0.0` | Seconds between health checks. `0` disables. |
| `max_recreation_attempts` | int | `3` | Max recreation attempts on health failure. |
| `scope` | string | `"worker"` | `"worker"`, `"task"`, `"thread"`, or `"request"`. |
| `depends_on` | list[string] | `[]` | Resource names this one depends on. |
| `pool_size` | int | `4` | Task scope: max concurrent instances. |
| `pool_min` | int | `0` | Task scope: pre-warmed instances at startup. |
| `acquire_timeout` | float | `10.0` | Task scope: seconds to wait for a pool instance. |
| `max_lifetime` | float | `3600.0` | Task scope: max seconds an instance lives. |
| `idle_timeout` | float | `300.0` | Task scope: max idle seconds before eviction. |
| `reloadable` | bool | `false` | Allow hot reload via SIGHUP or CLI. |
| `frozen` | bool | `false` | Wrap instance in a read-only proxy. |

## Pool configuration

Pool parameters apply only to task-scoped resources (`scope = "task"`). They control the bounded pool that manages concurrent instances.

| Parameter | Default | Description |
|---|---|---|
| `pool_size` | `4` | Max concurrent instances. Tasks block if the pool is exhausted. |
| `pool_min` | `0` | Instances pre-warmed at startup. `0` means lazy creation. |
| `acquire_timeout` | `10.0` | Seconds to wait for an available instance before raising `ResourceUnavailableError`. |
| `max_lifetime` | `3600.0` | Max seconds a pooled instance can live before it is replaced. |
| `idle_timeout` | `300.0` | Max seconds an instance can sit idle in the pool. |

```python
@queue.worker_resource(
    "session",
    scope="task",
    pool_size=20,
    pool_min=5,
    acquire_timeout=5.0,
    max_lifetime=1800.0,
)
def create_session(db):
    return db()
```

Setting `pool_min > 0` causes the pool to prewarm instances at worker startup. This avoids the cold-start latency on the first burst of tasks.

## Frozen resources

Wrap a resource in a read-only proxy to prevent accidental mutation:

```python
@queue.worker_resource("config", frozen=True)
def load_config():
    return AppConfig.from_env()
```

Attempts to set attributes on a frozen resource raise `AttributeError`. This is useful for configuration objects that should be treated as immutable after initialization.

## Hot reload

Mark resources as reloadable to update them without restarting the worker:

```python
@queue.worker_resource("feature_flags", reloadable=True)
def load_flags():
    return FeatureFlags.from_remote()
```

Trigger a reload by sending `SIGHUP` to the worker process:

```bash
kill -HUP <worker-pid>
```

Or via the CLI:

```bash
taskito reload --pid <worker-pid>
taskito reload --pid <worker-pid> --resource feature_flags  # reload one resource
```

Or programmatically from application code:

```python
results = queue._resource_runtime.reload()
# {"feature_flags": True}
```

Only resources declared with `reloadable=True` are affected. Non-reloadable resources are left running — no teardown or reconnection.

Resources are reloaded in the same topological order as initialization. If a reloadable resource depends on another reloadable resource, both are reloaded in dependency order.

!!! note
    SIGHUP is not available on Windows. Use the programmatic API instead.

## Programmatic resource registration

`load_resources()` and `@worker_resource()` both call `register_resource()` internally. You can call it directly for full control:

```python
from taskito.resources.definition import ResourceDefinition, ResourceScope

queue.register_resource(ResourceDefinition(
    name="db",
    factory=create_db,
    teardown=close_db,
    health_check=check_db,
    health_check_interval=30.0,
    scope=ResourceScope.WORKER,
    depends_on=["config"],
    reloadable=True,
))
```

`register_resource()` must be called before `run_worker()`.
