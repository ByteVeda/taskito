//! `JsQueue` — the producer/inspection surface over the core storage.

use napi::bindgen_prelude::{Buffer, Result};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction};
use napi_derive::napi;
use taskito_core::{Storage, StorageBackend};

use crate::config::{EnqueueOptions, OpenOptions, WorkerOptions};
use crate::convert::{build_new_job, job_to_js, JsJob, JsTaskInvocation};
use crate::error::to_napi_err;
use crate::worker::{start_worker, JsWorker};

/// A Taskito queue handle (SQLite/Postgres/Redis) exposed to JavaScript.
#[napi]
pub struct JsQueue {
    storage: StorageBackend,
    namespace: Option<String>,
}

#[napi]
impl JsQueue {
    /// Open (creating if needed) a queue's storage backend.
    #[napi(factory)]
    pub fn open(options: OpenOptions) -> Result<Self> {
        let namespace = options.namespace.clone();
        let storage = crate::backend::open(&options)?;
        Ok(Self { storage, namespace })
    }

    /// Enqueue `task_name` with an opaque serialized `payload`. Returns the job
    /// id. When `options.uniqueKey` is set, a duplicate enqueue is a no-op while
    /// the first job is pending/running (idempotency).
    #[napi]
    pub fn enqueue(
        &self,
        task_name: String,
        payload: Buffer,
        options: Option<EnqueueOptions>,
    ) -> Result<String> {
        let opts = options.unwrap_or_default();
        let unique = opts.unique_key.is_some();
        let new_job = build_new_job(task_name, payload.to_vec(), opts, self.namespace.as_deref());
        let job = if unique {
            self.storage.enqueue_unique(new_job)
        } else {
            self.storage.enqueue(new_job)
        }
        .map_err(to_napi_err)?;
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
        start_worker(
            self.storage.clone(),
            self.namespace.clone(),
            options.unwrap_or_default(),
            callback,
        )
    }
}
