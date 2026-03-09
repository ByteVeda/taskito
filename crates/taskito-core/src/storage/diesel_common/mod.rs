//! Shared Diesel-based implementations for SQLite and PostgreSQL backends.
//!
//! These macros generate the identical method implementations that both
//! Diesel-backed storage backends share, avoiding code duplication.

mod jobs;
mod locks;
mod logs;
mod metrics;

pub(crate) use jobs::impl_diesel_job_ops;
pub(crate) use locks::impl_diesel_lock_ops;
pub(crate) use logs::impl_diesel_log_ops;
pub(crate) use metrics::impl_diesel_metric_ops;
