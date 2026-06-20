//! `NodeDispatcher` — runs each job by calling back into JavaScript.
//!
//! Implements the core [`WorkerDispatcher`] trait. For every dequeued job it
//! invokes the JS task callback via a `ThreadsafeFunction`, awaits the returned
//! `Promise<Buffer>`, and reports a [`JobResult`] back to the scheduler. This is
//! the Node mirror of the Python shell's worker pool.

use std::time::Instant;

use crossbeam_channel::Sender;
use napi::bindgen_prelude::{spawn, Buffer, Promise};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use taskito_core::job::Job;
use taskito_core::scheduler::JobResult;
use taskito_core::worker::WorkerDispatcher;
use tokio::sync::oneshot;

use crate::convert::JsTaskInvocation;

/// Task callback registered from JS: `(invocation) => Promise<Buffer>`.
type TaskCallback = ThreadsafeFunction<JsTaskInvocation, ErrorStrategy::Fatal>;

/// Executes jobs by dispatching them to a JavaScript callback.
pub struct NodeDispatcher {
    callback: TaskCallback,
}

impl NodeDispatcher {
    pub fn new(callback: TaskCallback) -> Self {
        Self { callback }
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
            let result_tx = result_tx.clone();
            spawn(async move {
                let result = run_one(&callback, job).await;
                let _ = result_tx.send(result);
            });
        }
    }

    fn shutdown(&self) {}
}

/// Invoke the JS task for one job and translate the outcome into a [`JobResult`].
async fn run_one(callback: &TaskCallback, job: Job) -> JobResult {
    let started = Instant::now();
    let invocation = JsTaskInvocation {
        id: job.id.clone(),
        task_name: job.task_name.clone(),
        payload: Buffer::from(job.payload.clone()),
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

    let outcome = rx.await;
    let wall_time_ns = started.elapsed().as_nanos() as i64;
    match outcome {
        Ok(Ok(result)) => JobResult::Success {
            job_id: job.id,
            result: Some(result),
            task_name: job.task_name,
            wall_time_ns,
        },
        Ok(Err(err)) => failure(job, err.to_string(), wall_time_ns),
        Err(_) => failure(job, "node task channel dropped".to_string(), wall_time_ns),
    }
}

/// Build a retryable [`JobResult::Failure`] from a job and error message.
fn failure(job: Job, error: String, wall_time_ns: i64) -> JobResult {
    JobResult::Failure {
        job_id: job.id,
        error,
        retry_count: job.retry_count,
        max_retries: job.max_retries,
        task_name: job.task_name,
        wall_time_ns,
        should_retry: true,
        timed_out: false,
    }
}
