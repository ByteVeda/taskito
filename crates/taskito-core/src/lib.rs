pub mod error;
pub mod job;
pub mod periodic;
pub mod pubsub;
pub mod resilience;
pub mod scheduler;
pub mod storage;
pub mod worker;

// Primary public API — the types most consumers need. The crate root is the
// blessed import path; submodules stay public for discoverability but new code
// should prefer these re-exports.
pub use error::{QueueError, Result};
pub use job::{now_millis, Job, JobCompletion, JobStatus, NewJob};
pub use resilience::circuit_breaker::{CircuitBreakerConfig, CircuitState};
pub use resilience::rate_limiter::RateLimitConfig;
pub use resilience::retry::RetryPolicy;
pub use scheduler::retention::RetentionConfig;
pub use scheduler::{
    JobResult, QueueConfig, ResultOutcome, Scheduler, SchedulerConfig, TaskConfig,
};
pub use storage::cursor::Page;
#[cfg(feature = "postgres")]
pub use storage::postgres::PostgresStorage;
pub use storage::records::{
    CircuitBreakerState, JobError, LockInfo, NewPeriodicTask, NewSubscription, PeriodicTask,
    RateLimitState, ReplayEntry, Subscription, TaskLogEntry, TaskMetric, WorkerInfo,
};
#[cfg(feature = "redis")]
pub use storage::redis_backend::RedisStorage;
pub use storage::sqlite::SqliteStorage;
pub use storage::Storage;
pub use storage::StorageBackend;
pub use storage::{DeadJob, QueueStats, SubscriptionBacklogStats};
pub use worker::{
    NativeDispatcher, TaskError, TaskRegistry, TaskResult, Worker, WorkerDispatcher, WorkerHandle,
};
