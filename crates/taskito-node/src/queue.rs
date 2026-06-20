//! `JsQueue` — the producer/inspection surface over the core storage.

use napi::bindgen_prelude::{Buffer, Result};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction};
use napi_derive::napi;
use taskito_core::{SqliteStorage, Storage, StorageBackend};

use crate::config::{EnqueueOptions, WorkerOptions};
use crate::convert::{build_new_job, job_to_js, JsJob, JsTaskInvocation};
use crate::error::to_napi_err;
use crate::worker::{start_worker, JsWorker};

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

    /// Start a worker that runs `callback` for each dequeued job. Returns a
    /// [`JsWorker`] handle — call `stop()` on it to shut the worker down.
    #[napi]
    pub fn run_worker(
        &self,
        callback: ThreadsafeFunction<JsTaskInvocation, ErrorStrategy::Fatal>,
        options: Option<WorkerOptions>,
    ) -> JsWorker {
        start_worker(self.storage.clone(), options.unwrap_or_default(), callback)
    }
}
