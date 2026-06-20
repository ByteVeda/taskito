//! `JsQueue` — the producer/inspection surface over the core storage.

use napi::bindgen_prelude::{Buffer, Result};
use napi_derive::napi;
use taskito_core::{SqliteStorage, Storage, StorageBackend};

use crate::config::EnqueueOptions;
use crate::conversion::{build_new_job, job_to_js, JsJob};
use crate::error::to_napi_err;

/// A SQLite-backed Taskito queue handle exposed to JavaScript.
#[napi]
pub struct JsQueue {
    storage: StorageBackend,
}

#[napi]
impl JsQueue {
    /// Open (creating if needed) a SQLite-backed queue at `db_path`.
    #[napi(constructor)]
    pub fn new(db_path: String) -> Result<Self> {
        let storage = SqliteStorage::new(&db_path).map_err(to_napi_err)?;
        Ok(Self {
            storage: StorageBackend::Sqlite(storage),
        })
    }

    /// Enqueue `task_name` with an opaque serialized `payload`. Returns the job id.
    #[napi]
    pub fn enqueue(
        &self,
        task_name: String,
        payload: Buffer,
        options: Option<EnqueueOptions>,
    ) -> Result<String> {
        let new_job = build_new_job(task_name, payload.to_vec(), options.unwrap_or_default());
        let job = self.storage.enqueue(new_job).map_err(to_napi_err)?;
        Ok(job.id)
    }

    /// Fetch a job by id, or `null` if no such job exists.
    #[napi]
    pub fn get_job(&self, id: String) -> Result<Option<JsJob>> {
        let job = self.storage.get_job(&id).map_err(to_napi_err)?;
        Ok(job.map(job_to_js))
    }
}
