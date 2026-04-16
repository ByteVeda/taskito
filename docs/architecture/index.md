# Architecture

taskito is a hybrid Python/Rust system. Python provides the user-facing API. Rust handles all the heavy lifting: storage, scheduling, dispatch, rate limiting, and worker management.

```mermaid
flowchart TD
    subgraph py ["Python Layer"]
        direction LR
        Q["Queue"] --> IC["ArgumentInterceptor"]
        TW["@queue.task()"] ~~~ RR["ResourceRuntime"]
    end

    subgraph rust ["Rust Core — PyO3"]
        direction LR
        PQ["PyQueue"] --> SCH["Scheduler"]
        SCH --> WP["Worker Pool"]
        SCH --> RL["Rate Limiter"]
    end

    subgraph storage ["Storage"]
        direction LR
        SQ[("SQLite")] ~~~ PG[("PostgreSQL")]
    end

    IC --> PQ
    WP -->|"acquire GIL"| TW
    SCH -->|"poll / update"| SQ
    PQ -->|"INSERT"| SQ
```

## Section overview

| Page | What it covers |
|---|---|
| [Job Lifecycle](job-lifecycle.md) | State machine, status codes, transitions |
| [Worker Pool](worker-pool.md) | Thread architecture, async dispatch, GIL management |
| [Storage Layer](storage.md) | SQLite pragmas, schema, indexes, Postgres differences |
| [Scheduler](scheduler.md) | Poll loop, dispatch flow, periodic tasks |
| [Resource System](resources.md) | Argument interception, DI, proxy reconstruction |
| [Failure Model](failure-model.md) | Crash recovery, duplicate execution, partial writes |
| [Serialization](serialization.md) | Pluggable serializers, format details |
