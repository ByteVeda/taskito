# Resource Proxies

Proxies handle objects that are neither serializable primitives nor DI-injectable — things like file handles, HTTP sessions, and cloud clients that have capturable state.

When interception detects a proxy-able argument, the handler's `deconstruct()` method extracts a JSON-serializable recipe. The worker calls `reconstruct()` to rebuild the live object before invoking the task. After the task completes, `cleanup()` is called on the reconstructed object.

Proxies require interception to be enabled:

```python
queue = Queue(db_path="tasks.db", interception="strict")
```

## Built-in handlers

| Handler name | Handled types | Notes |
|---|---|---|
| `"file"` | `io.TextIOWrapper`, `io.BufferedReader`, `io.BufferedWriter`, `io.FileIO` | Stores path + mode; worker reopens the file |
| `"logger"` | `logging.Logger` | Stores logger name; worker resolves `logging.getLogger(name)` |
| `"requests_session"` | `requests.Session` | Stores headers, auth, timeout, verify; worker creates a new session |
| `"httpx_client"` | `httpx.Client`, `httpx.AsyncClient` | Stores base_url, headers, timeout, verify |
| `"boto3_client"` | boto3 clients (`botocore.client.BaseClient`) | Stores service name, region, endpoint_url; credentials are NOT included |
| `"gcs_client"` | `google.cloud.storage.Client`, `Bucket`, `Blob` | Stores project and resource identifiers; credentials are NOT included |

`requests`, `httpx`, `boto3`, and `google-cloud-storage` are optional. Their handlers register automatically when the library is installed.

## HMAC signing

Proxy recipes are signed with HMAC-SHA256 to prevent recipe tampering between enqueue and execution:

```python
queue = Queue(
    db_path="tasks.db",
    interception="strict",
    recipe_signing_key="your-secret-key",
)
```

If `recipe_signing_key` is not set on the constructor, it falls back to the `TASKITO_RECIPE_SECRET` environment variable. Signed recipes are verified at reconstruction time — a modified or forged recipe raises `ProxyReconstructionError`.

!!! warning
    Omitting a signing key means recipes are not verified. Use a signing key in production.

## Security options

### Reconstruction timeout

Limit how long reconstruction can take before raising `ProxyReconstructionError`:

```python
queue = Queue(
    db_path="tasks.db",
    max_reconstruction_timeout=5.0,  # seconds, default 5.0
)
```

### File path allowlist

Restrict which file paths the file proxy handler is allowed to reconstruct:

```python
queue = Queue(
    db_path="tasks.db",
    file_path_allowlist=["/data/uploads/", "/tmp/taskito/"],
)
```

Paths outside the allowlist raise `ProxyReconstructionError` during reconstruction. Without an allowlist, any path is permitted.

### Disabling specific handlers

Disable individual handlers by name:

```python
queue = Queue(
    db_path="tasks.db",
    disabled_proxies=["requests_session", "gcs_client"],
)
```

Disabled handlers are not registered. Arguments of those types fall through to the serializer — or are rejected if they would otherwise be PROXY-classified and interception is strict.

## Cloud handlers

### AWS (boto3)

```bash
pip install taskito[aws]   # adds boto3>=1.20
```

The `boto3_client` handler stores the service name, region, and optional endpoint URL. **Credentials are not stored in the recipe.** The worker uses its own ambient credentials — IAM role, environment variables, or `~/.aws/credentials`.

```python
import boto3

s3 = boto3.client("s3", region_name="us-east-1")
process_upload.delay(s3, "my-bucket/key")
# Recipe: {"service_name": "s3", "region_name": "us-east-1", "endpoint_url": null}
# Worker recreates: boto3.client("s3", region_name="us-east-1")
```

### Google Cloud Storage

```bash
pip install taskito[gcs]   # adds google-cloud-storage>=2.0
```

The `gcs_client` handler stores the project and resource identifiers for `Client`, `Bucket`, and `Blob` objects. **Credentials are not stored.** The worker uses Application Default Credentials.

```python
from google.cloud import storage

client = storage.Client(project="my-project")
blob = client.bucket("my-bucket").blob("file.parquet")
process_file.delay(blob)
# Recipe: {"type": "blob", "project": "my-project", "bucket_name": "my-bucket", "blob_name": "file.parquet"}
```

## `NoProxy` wrapper

Opt out of proxy handling for a specific argument. The value is passed through to the serializer as-is:

```python
from taskito import NoProxy

session = requests.Session()
session.headers["Authorization"] = "Bearer token"

# Pass to cloudpickle instead of the proxy system
process.delay(NoProxy(session))
```

Use `NoProxy` when the serializer can handle the value directly (e.g., with cloudpickle) or when you want to suppress proxy handling for a specific call without disabling the handler globally.

## Proxy metrics

```python
stats = queue.proxy_stats()
# [
#   {
#     "handler": "file",
#     "total_reconstructions": 42,
#     "total_errors": 0,
#     "total_cleanup_errors": 0,
#     "total_checksum_failures": 0,
#     "total_duration_ms": 50.4,
#     "avg_duration_ms": 1.2,
#     "max_duration_ms": 8.1,
#     "p95_duration_ms": 3.4,
#   },
#   ...
# ]
```

See [Observability](observability.md) for Prometheus metrics and dashboard endpoints.
