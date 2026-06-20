//! Feature-gated construction of a [`StorageBackend`] from JS [`OpenOptions`].

use napi::bindgen_prelude::{Error, Result, Status};
use taskito_core::{SqliteStorage, StorageBackend};

use crate::config::OpenOptions;
use crate::error::to_napi_err;

const DEFAULT_SQLITE_POOL: u32 = 8;
#[cfg(feature = "postgres")]
const DEFAULT_POSTGRES_POOL: u32 = 10;
#[cfg(feature = "postgres")]
const DEFAULT_POSTGRES_SCHEMA: &str = "taskito";

/// Open the storage backend named by `options.backend` (default `"sqlite"`).
/// Returns an error if a requested backend was not compiled into this addon.
pub fn open(options: &OpenOptions) -> Result<StorageBackend> {
    match options.backend.as_deref().unwrap_or("sqlite") {
        "sqlite" => {
            let pool = options.pool_size.unwrap_or(DEFAULT_SQLITE_POOL);
            let storage = SqliteStorage::with_pool_size(&options.dsn, pool).map_err(to_napi_err)?;
            Ok(StorageBackend::Sqlite(storage))
        }
        #[cfg(feature = "postgres")]
        "postgres" => {
            let schema = options.schema.as_deref().unwrap_or(DEFAULT_POSTGRES_SCHEMA);
            let pool = options.pool_size.unwrap_or(DEFAULT_POSTGRES_POOL);
            let storage =
                taskito_core::PostgresStorage::with_schema_and_pool_size(&options.dsn, schema, pool)
                    .map_err(to_napi_err)?;
            Ok(StorageBackend::Postgres(storage))
        }
        #[cfg(feature = "redis")]
        "redis" => {
            let storage = match options.prefix.as_deref() {
                Some(prefix) => taskito_core::RedisStorage::with_prefix(&options.dsn, prefix),
                None => taskito_core::RedisStorage::new(&options.dsn),
            }
            .map_err(to_napi_err)?;
            Ok(StorageBackend::Redis(storage))
        }
        other => Err(Error::new(
            Status::InvalidArg,
            format!("backend '{other}' is not available (not a known backend, or this addon was built without its cargo feature)"),
        )),
    }
}
