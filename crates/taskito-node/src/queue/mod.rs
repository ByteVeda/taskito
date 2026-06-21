//! `JsQueue` — the producer/inspection surface over the core storage.

use napi::bindgen_prelude::{Buffer, Result};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction};
use napi_derive::napi;
use taskito_core::{Storage, StorageBackend};

use crate::config::{EnqueueJob, EnqueueOptions, OpenOptions, WorkerOptions};
use crate::convert::{build_new_job, job_to_js, JsJob, JsOutcome, JsTaskInvocation};
use crate::error::to_napi_err;
use crate::worker::{start_worker, JsWorker};

mod admin;
mod inspect;
mod locks;
mod logs;
mod periodic;
#[cfg(feature = "workflows")]
mod workflows;

/// A Taskito queue handle (SQLite/Postgres/Redis) exposed to JavaScript.
#[napi]
pub struct JsQueue {
    storage: StorageBackend,
    namespace: Option<String>,
    /// Workflow storage, lazily initialized on first workflow call so the
    /// workflow migrations only run when workflows are actually used.
    #[cfg(feature = "workflows")]
    workflow_storage: std::sync::OnceLock<taskito_workflows::WorkflowStorageBackend>,
}

#[napi]
impl JsQueue {
    /// Open (creating if needed) a queue's storage backend.
    #[napi(factory)]
    pub fn open(options: OpenOptions) -> Result<Self> {
        let namespace = options.namespace.clone();
        let storage = crate::backend::open(&options)?;
        Ok(Self {
            storage,
            namespace,
            #[cfg(feature = "workflows")]
            workflow_storage: std::sync::OnceLock::new(),
        })
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
        let new_job = build_new_job(task_name, payload.to_vec(), opts, self.namespace.as_deref())?;
        let job = if unique {
            self.storage.enqueue_unique(new_job)
        } else {
            self.storage.enqueue(new_job)
        }
        .map_err(to_napi_err)?;
        Ok(job.id)
    }

    /// Enqueue a batch of jobs for one `task_name` in a single storage call.
    /// Each entry carries its own payload and options. Returns the new job ids
    /// in input order. Unlike `enqueue`, the batch path does not apply
    /// `uniqueKey` dedup — it is a plain bulk insert for throughput.
    #[napi]
    pub fn enqueue_many(&self, task_name: String, jobs: Vec<EnqueueJob>) -> Result<Vec<String>> {
        let namespace = self.namespace.as_deref();
        let new_jobs = jobs
            .into_iter()
            .map(|job| {
                let opts = job.options.unwrap_or_default();
                build_new_job(task_name.clone(), job.payload.to_vec(), opts, namespace)
            })
            .collect::<Result<Vec<_>>>()?;
        let created = self.storage.enqueue_batch(new_jobs).map_err(to_napi_err)?;
        Ok(created.into_iter().map(|job| job.id).collect())
    }

    /// Fetch a job by id, or `null` if no such job exists.
    #[napi]
    pub fn get_job(&self, id: String) -> Result<Option<JsJob>> {
        let job = self.storage.get_job(&id).map_err(to_napi_err)?;
        Ok(job.map(job_to_js))
    }

    /// Cancel a pending job immediately. Returns false if it was not pending.
    #[napi]
    pub fn cancel_job(&self, id: String) -> Result<bool> {
        self.storage.cancel_job(&id).map_err(to_napi_err)
    }

    /// Request cancellation of a running job (cooperative). Returns false if
    /// there is no such running job.
    #[napi]
    pub fn request_cancel(&self, id: String) -> Result<bool> {
        self.storage.request_cancel(&id).map_err(to_napi_err)
    }

    /// Whether cancellation has been requested for a job.
    #[napi]
    pub fn is_cancel_requested(&self, id: String) -> Result<bool> {
        self.storage.is_cancel_requested(&id).map_err(to_napi_err)
    }

    /// Update a running job's progress (0–100), for observability.
    #[napi]
    pub fn update_progress(&self, id: String, progress: i32) -> Result<()> {
        self.storage
            .update_progress(&id, progress.clamp(0, 100))
            .map_err(to_napi_err)
    }

    /// Start a worker that runs `callback` for each dequeued job. Returns a
    /// [`JsWorker`] handle — call `stop()` on it to shut the worker down.
    #[napi]
    pub fn run_worker(
        &self,
        callback: ThreadsafeFunction<JsTaskInvocation, ErrorStrategy::Fatal>,
        outcome_callback: ThreadsafeFunction<JsOutcome, ErrorStrategy::Fatal>,
        options: Option<WorkerOptions>,
    ) -> Result<JsWorker> {
        start_worker(
            self.storage.clone(),
            self.namespace.clone(),
            options.unwrap_or_default(),
            callback,
            outcome_callback,
        )
    }
}
