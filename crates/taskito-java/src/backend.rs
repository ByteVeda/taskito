//! Construct a [`QueueHandle`] from caller options (mirrors the Node shell).

use taskito_core::{SqliteStorage, StorageBackend};

use crate::convert::OpenOptions;
use crate::error::BindingError;

const DEFAULT_SQLITE_POOL: u32 = 8;
#[cfg(feature = "postgres")]
const DEFAULT_POSTGRES_POOL: u32 = 10;
#[cfg(feature = "postgres")]
const DEFAULT_POSTGRES_SCHEMA: &str = "taskito";

/// An open queue: the storage backend plus the default namespace applied to
/// enqueues that do not specify their own.
pub struct QueueHandle {
    pub storage: StorageBackend,
    pub namespace: Option<String>,
}

/// Error for a backend that is unknown or whose cargo feature is not compiled in.
fn unknown_backend(name: &str) -> BindingError {
    BindingError::new(format!(
        "backend '{name}' is not available (unknown, or this build omits its cargo feature)"
    ))
}

/// Reject an explicit zero pool size — r2d2 panics when `max_size == 0`, which
/// would take down the whole JVM.
fn resolve_pool_size(pool_size: Option<u32>, default: u32) -> Result<u32, BindingError> {
    match pool_size {
        Some(0) => Err(BindingError::new("poolSize must be greater than 0")),
        Some(n) => Ok(n),
        None => Ok(default),
    }
}

/// Open the storage backend named by `options.backend` (default `"sqlite"`).
/// Returns an error if a requested backend was not compiled into this library.
pub fn open(options: OpenOptions) -> Result<QueueHandle, BindingError> {
    let storage = match options.backend.as_deref().unwrap_or("sqlite") {
        "sqlite" => {
            let pool = resolve_pool_size(options.pool_size, DEFAULT_SQLITE_POOL)?;
            StorageBackend::Sqlite(SqliteStorage::with_pool_size(&options.dsn, pool)?)
        }
        #[cfg(feature = "postgres")]
        "postgres" => {
            let schema = options.schema.as_deref().unwrap_or(DEFAULT_POSTGRES_SCHEMA);
            let pool = resolve_pool_size(options.pool_size, DEFAULT_POSTGRES_POOL)?;
            StorageBackend::Postgres(taskito_core::PostgresStorage::with_schema_and_pool_size(
                &options.dsn,
                schema,
                pool,
            )?)
        }
        #[cfg(feature = "redis")]
        "redis" => {
            let storage = match options.prefix.as_deref() {
                Some(prefix) => taskito_core::RedisStorage::with_prefix(&options.dsn, prefix),
                None => taskito_core::RedisStorage::new(&options.dsn),
            }?;
            StorageBackend::Redis(storage)
        }
        other => return Err(unknown_backend(other)),
    };
    Ok(QueueHandle {
        storage,
        namespace: options.namespace,
    })
}
