use thiserror::Error;

#[derive(Error, Debug)]
pub enum QueueError {
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),

    #[error("connection pool error: {0}")]
    Pool(#[from] r2d2::Error),

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

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, QueueError>;
