use thiserror::Error;

#[derive(Error, Debug)]
pub enum QueueError {
    #[error("storage error: {0}")]
    Storage(#[from] diesel::result::Error),

    #[error("connection pool error: {0}")]
    Pool(#[from] diesel::r2d2::PoolError),

    #[error("job not found: {0}")]
    JobNotFound(String),

    #[error("task not registered: {0}")]
    TaskNotRegistered(String),

    #[error("serialization error: {0}")]
    Serialization(String),

    #[error("worker error: {0}")]
    Worker(String),

    #[error("scheduler error: {0}")]
    Scheduler(String),

    #[error("rate limit exceeded for: {0}")]
    RateLimitExceeded(String),

    #[error("job timed out: {0}")]
    Timeout(String),

    #[error("config error: {0}")]
    Config(String),

    #[error("dependency not found: {0}")]
    DependencyNotFound(String),

    #[error("lock not acquired: {0}")]
    LockNotAcquired(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, QueueError>;
