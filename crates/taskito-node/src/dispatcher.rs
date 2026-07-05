//! `NodeDispatcher` — runs each job by calling back into JavaScript.
//!
//! Implements the core [`WorkerDispatcher`] trait. For every dequeued job it
//! invokes the JS task callback via a `ThreadsafeFunction`, awaits the returned
//! `Promise<Buffer>`, and reports a [`JobResult`] back to the scheduler. This is
//! the Node mirror of the Python shell's worker pool.

use std::time::{Duration, Instant};

use crossbeam_channel::Sender;
use napi::bindgen_prelude::{spawn, spawn_blocking, Buffer, Promise};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use taskito_core::job::Job;
use taskito_core::scheduler::JobResult;
use taskito_core::worker::WorkerDispatcher;
use taskito_core::{Storage, StorageBackend};
use tokio::sync::oneshot;

use crate::convert::JsTaskInvocation;

/// Task callback registered from JS: `(invocation) => Promise<Buffer>`.
type TaskCallback = ThreadsafeFunction<JsTaskInvocation, ErrorStrategy::Fatal>;

/// Executes jobs by dispatching them to a JavaScript callback.
pub struct NodeDispatcher {
    callback: TaskCallback,
    storage: StorageBackend,
}

impl NodeDispatcher {
    pub fn new(callback: TaskCallback, storage: StorageBackend) -> Self {
        Self { callback, storage }
    }
}

#[async_trait::async_trait]
impl WorkerDispatcher for NodeDispatcher {
    async fn run(
        &self,
        mut job_rx: tokio::sync::mpsc::Receiver<Job>,
        result_tx: Sender<JobResult>,
    ) {
        // Run jobs concurrently — each invocation is independent and the JS
        // side may be async. The scheduler bounds in-flight work via the
        // channel capacity and per-task/queue concurrency gates.
        while let Some(job) = job_rx.recv().await {
            let callback = self.callback.clone();
            let storage = self.storage.clone();
            let result_tx = result_tx.clone();
            spawn(async move {
                let job_id = job.id.clone();
                let result = run_one(&callback, &storage, job).await;
                // A full bounded channel parks the sender — do it on the
                // blocking pool, never on the shared async runtime.
                match spawn_blocking(move || result_tx.send(result)).await {
                    Ok(Ok(())) => {}
                    Ok(Err(_)) | Err(_) => {
                        // A closed channel means the drain loop died — surface it.
                        log::error!(
                            "[taskito-node] result channel closed; dropping outcome for {job_id}"
                        );
                    }
                }
            });
        }
    }

    fn shutdown(&self) {}
}

/// Invoke the JS task for one job and translate the outcome into a [`JobResult`].
async fn run_one(callback: &TaskCallback, storage: &StorageBackend, mut job: Job) -> JobResult {
    let started = Instant::now();
    let invocation = JsTaskInvocation {
        id: job.id.clone(),
        task_name: job.task_name.clone(),
        // Never read from `job` again — take, don't clone (payloads can be
        // large); `job` stays whole for the later `failure(job, ...)` moves.
        payload: Buffer::from(std::mem::take(&mut job.payload)),
    };

    // The callback runs on the JS thread and returns a Promise; bridge its
    // awaited value back to this async context through a oneshot.
    let (tx, rx) = oneshot::channel::<napi::Result<Vec<u8>>>();
    callback.call_with_return_value(
        invocation,
        ThreadsafeFunctionCallMode::NonBlocking,
        move |promise: Promise<Buffer>| {
            spawn(async move {
                let outcome = promise.await.map(|buffer| buffer.to_vec());
                let _ = tx.send(outcome);
            });
            Ok(())
        },
    );

    // Enforce the per-job timeout (the core stores `timeout_ms` but leaves
    // enforcement to the shell). `timeout_ms <= 0` means no limit.
    let timed = if job.timeout_ms > 0 {
        tokio::time::timeout(Duration::from_millis(job.timeout_ms as u64), rx).await
    } else {
        Ok(rx.await)
    };
    let wall_time_ns = started.elapsed().as_nanos() as i64;
    match timed {
        Ok(Ok(Ok(result))) => JobResult::Success {
            job_id: job.id,
            result: Some(result),
            task_name: job.task_name,
            wall_time_ns,
        },
        Ok(Ok(Err(err))) => {
            // A rejected task that was cancel-requested is a cancellation, not a
            // failure (the JS side aborts via the cancel signal).
            if storage.is_cancel_requested(&job.id).unwrap_or(false) {
                JobResult::Cancelled {
                    job_id: job.id,
                    task_name: job.task_name,
                    wall_time_ns,
                }
            } else {
                failure(job, err.to_string(), wall_time_ns, false)
            }
        }
        Ok(Err(_)) => failure(
            job,
            "node task channel dropped".to_string(),
            wall_time_ns,
            false,
        ),
        // We report the timeout, but the underlying JS promise cannot be force-
        // killed and keeps running in the background — same limitation as the
        // Python shell. Non-idempotent tasks should cooperate via the cancel
        // signal (`currentJob().signal`) and check it on long operations.
        Err(_) => failure(job, "task timed out".to_string(), wall_time_ns, true),
    }
}

/// Build a retryable [`JobResult::Failure`] from a job and error message.
fn failure(job: Job, error: String, wall_time_ns: i64, timed_out: bool) -> JobResult {
    JobResult::Failure {
        job_id: job.id,
        error,
        retry_count: job.retry_count,
        max_retries: job.max_retries,
        task_name: job.task_name,
        wall_time_ns,
        should_retry: true,
        timed_out,
    }
}
