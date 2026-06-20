//! Periodic (cron) task registration. The worker's maintenance loop enqueues
//! due tasks; this binds only registration. Re-registering an existing name
//! replaces it (upsert).

use napi::bindgen_prelude::{Buffer, Result};
use napi_derive::napi;
use taskito_core::job::now_millis;
use taskito_core::periodic::{next_cron_time, next_cron_time_tz};
use taskito_core::storage::models::NewPeriodicTaskRow;
use taskito_core::Storage;

use super::JsQueue;
use crate::error::to_napi_err;

const DEFAULT_QUEUE: &str = "default";

#[napi]
impl JsQueue {
    /// Register (or replace) a cron-scheduled task. `args` is the opaque,
    /// already-serialized payload handed to the task when it fires. Returns the
    /// next fire time (Unix ms); the worker maintenance loop enqueues the job
    /// once due. Rejects an invalid cron expression.
    #[napi]
    #[allow(clippy::too_many_arguments)]
    pub fn register_periodic(
        &self,
        name: String,
        task_name: String,
        cron_expr: String,
        args: Option<Buffer>,
        queue: Option<String>,
        timezone: Option<String>,
        enabled: Option<bool>,
    ) -> Result<i64> {
        let now = now_millis();
        let next_run = match &timezone {
            Some(tz) => next_cron_time_tz(&cron_expr, now, tz),
            None => next_cron_time(&cron_expr, now),
        }
        .map_err(to_napi_err)?;

        let args_bytes = args.map(|b| b.to_vec());
        let row = NewPeriodicTaskRow {
            name: &name,
            task_name: &task_name,
            cron_expr: &cron_expr,
            args: args_bytes.as_deref(),
            kwargs: None,
            queue: queue.as_deref().unwrap_or(DEFAULT_QUEUE),
            enabled: enabled.unwrap_or(true),
            next_run,
            timezone: timezone.as_deref(),
        };
        self.storage.register_periodic(&row).map_err(to_napi_err)?;
        Ok(next_run)
    }
}
