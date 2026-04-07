# Comparison

**TL;DR**: Taskito is Celery without the broker. Rust scheduler, no Redis/RabbitMQ, lower latency, better concurrency. Start with SQLite, scale to Postgres when needed.

## Feature Matrix

| Feature | taskito | Celery | RQ | Dramatiq | Huey | TaskIQ |
|---|---|---|---|---|---|---|
| Broker required | **No** | Redis / RabbitMQ | Redis | Redis / RabbitMQ | Redis | Redis / RabbitMQ / Nats |
| Core language | **Rust + Python** | Python | Python | Python | Python | Python |
| Priority queues | **Yes** | Yes | No | No | Yes | Yes |
| Rate limiting | **Yes** | Yes | No | Yes | No | No |
| Dead letter queue | **Yes** | No | Yes | No | No | No |
| Task chaining | **Yes** (chain/group/chord) | Yes (canvas) | No | Yes (pipelines) | No | Yes (pipelines) |
| Job cancellation | **Yes** | Yes (revoke) | No | No | Yes | No |
| Progress tracking | **Yes** | Yes (custom) | No | No | No | No |
| Unique tasks | **Yes** | No (manual) | No | No | Yes | No |
| Batch enqueue | **Yes** | No | No | No | No | No |
| Retry with backoff | **Yes** (exponential + jitter) | Yes | Yes | Yes | Yes | Yes |
| Periodic/cron tasks | **Yes** (6-field with seconds) | Yes (celery-beat) | Yes (rq-scheduler) | Yes (APScheduler) | Yes | Yes (taskiq-cron) |
| Async support | **Yes** | Yes | No | No | No | Yes (native) |
| Cancel running tasks | **Yes** (cooperative) | Yes (revoke) | No | No | No | No |
| Soft timeouts | **Yes** | No | No | No | No | No |
| Custom serializers | **Yes** | Yes | No | No | No | Yes |
| Per-task middleware | **Yes** | No | No | Yes | No | Yes |
| Multi-process (prefork) | **Yes** | Yes | No | No | No | No |
| Namespace isolation | **Yes** | No | No | No | No | No |
| Result streaming | **Yes** (publish/stream) | No | No | No | No | No |
| Worker discovery | **Yes** (hostname/pid/status) | Yes (flower) | No | No | No | No |
| Lifecycle events | **Yes** (13 types) | Yes (signals) | No | Yes (actors) | No | No |
| Async canvas | **Yes** | No | No | No | No | No |
| OpenTelemetry | **Yes** (optional) | Yes (contrib) | No | No | No | Yes (built-in) |
| CLI | **Yes** | Yes | Yes | Yes | Yes | Yes |
| Result backend | **Built-in** (SQLite) | Redis / DB / custom | Redis | Redis / custom | Redis / SQLite | Redis / custom |
| Setup complexity | **`pip install`** | Broker + backend | Redis server | Broker | Redis server | Broker + backend |

## When to Use taskito

taskito is ideal when:

- **Single-machine deployments** — no need for distributed workers across multiple servers
- **Zero infrastructure** — you don't want to install, configure, or manage Redis or RabbitMQ
- **Embedded applications** — CLI tools, desktop apps, or services where simplicity matters
- **Prototyping** — get a task queue running in 5 lines, iterate fast
- **Low-to-medium throughput** — hundreds to thousands of jobs per second is plenty

## When NOT to Use taskito

Consider alternatives when:

- **Multi-server workers** — you need workers on separate machines (taskito supports this with Postgres/Redis backends, but Celery has more mature distributed tooling)
- **Very high throughput** — millions of jobs/sec across a cluster (use Celery + RabbitMQ)
- **Existing Redis infrastructure** — if Redis is already in your stack, RQ or Huey are simple choices
- **Complex routing** — you need topic exchanges, message filtering, or pub/sub patterns (use Celery + RabbitMQ)

## Detailed Comparison

### vs Celery

Celery is the most popular Python task queue — battle-tested, feature-rich, and widely adopted.

| | taskito | Celery |
|---|---|---|
| **Setup** | `pip install taskito` | Install broker (Redis/RabbitMQ), result backend, Celery itself |
| **Dependencies** | 1 (cloudpickle) | 10+ (kombu, billiard, vine, etc.) |
| **Configuration** | Constructor params | Settings module or app config |
| **Worker model** | Rust OS threads | prefork/eventlet/gevent pools |
| **Distributed** | No (single process) | Yes (multi-server) |
| **Canvas** | chain, group, chord, starmap, chunks | chain, group, chord, starmap, chunks, and more |

**Choose taskito** if you want zero-infrastructure simplicity on a single machine.
**Choose Celery** if you need distributed workers, complex routing, or enterprise features.

Looking to switch? See the [Migrating from Celery](guide/operations/migration.md) guide for a step-by-step walkthrough with side-by-side code examples.

### vs RQ (Redis Queue)

RQ focuses on simplicity — a minimal task queue built on Redis.

| | taskito | RQ |
|---|---|---|
| **Broker** | None (SQLite) | Redis required |
| **Priority** | Yes (integer levels) | Separate queues for priority |
| **Rate limiting** | Built-in | No |
| **Chaining** | Yes | No |
| **Monitoring** | CLI + progress | rq-dashboard (web) |

**Choose taskito** if you want similar simplicity without requiring Redis.
**Choose RQ** if you already run Redis and want a web dashboard.

### vs Dramatiq

Dramatiq is a reliable, performance-focused alternative to Celery.

| | taskito | Dramatiq |
|---|---|---|
| **Broker** | None (SQLite) | Redis or RabbitMQ |
| **Priority** | Yes | No (FIFO only) |
| **Rate limiting** | Built-in | Middleware |
| **DLQ** | Built-in | No |
| **Middleware** | Hooks + per-task `TaskMiddleware` | Full middleware stack |

**Choose taskito** if you want built-in DLQ and priority without a broker.
**Choose Dramatiq** if you need a middleware ecosystem and distributed workers.

### vs Huey

Huey is a lightweight task queue with Redis or SQLite backends.

| | taskito | Huey |
|---|---|---|
| **Backend** | SQLite (Rust-native) | Redis or SQLite (Python) |
| **Performance** | Rust scheduler + OS threads | Python threads |
| **Chaining** | chain, group, chord | Pipeline (limited) |
| **Rate limiting** | Built-in token bucket | No |
| **DLQ** | Built-in | No |
| **Progress** | Built-in | No |

**Choose taskito** if you want higher performance and more features with SQLite.
**Choose Huey** if you need a mature, well-documented SQLite-backed queue.

### vs TaskIQ

TaskIQ is a modern, async-native task queue. It's a good fit if you're fully async and already have a broker.

| | taskito | TaskIQ |
|---|---|---|
| **Broker** | None (DB-backed) | Redis / RabbitMQ / Nats |
| **Async** | Native + sync | Async-first |
| **Scheduler** | Rust (Tokio) | Python |
| **GIL** | Rust scheduler bypasses GIL | Python scheduler competes for GIL |
| **Setup** | `pip install taskito` | Install broker + taskiq + broker plugin |

Choose taskito if you want zero infrastructure. Choose TaskIQ if you're fully async and already have Redis/Nats.
