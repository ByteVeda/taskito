pub mod error;
pub mod job;
pub mod periodic;
pub mod resilience;
pub mod scheduler;
pub mod storage;

// Primary public API — the types most consumers need.
pub use error::QueueError;
pub use job::{Job, JobStatus, NewJob};
pub use scheduler::{Scheduler, SchedulerConfig};
#[cfg(feature = "postgres")]
pub use storage::postgres::PostgresStorage;
#[cfg(feature = "redis")]
pub use storage::redis_backend::RedisStorage;
pub use storage::sqlite::SqliteStorage;
pub use storage::Storage;
pub use storage::StorageBackend;
