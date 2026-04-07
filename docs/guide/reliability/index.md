# Reliability

Harden your task queue for production workloads.

| Guide | Description |
|-------|-------------|
| [Retries & Dead Letters](retries.md) | Automatic retries with exponential backoff, dead letter queue |
| [Error Handling](error-handling.md) | Task failure lifecycle, error inspection, debugging patterns |
| [Delivery Guarantees](guarantees.md) | At-least-once delivery, idempotency, and exactly-once patterns |
| [Rate Limiting](rate-limiting.md) | Throttle task execution with token bucket rate limits |
| [Circuit Breakers](circuit-breakers.md) | Protect downstream services from cascading failures |
| [Distributed Locking](locking.md) | Mutual exclusion across workers with database-backed locks |
