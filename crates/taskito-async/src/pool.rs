use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use crossbeam_channel::Sender;
use pyo3::prelude::*;
use pyo3::types::PyBytes;
use tokio::sync::Semaphore;

use taskito_core::job::Job;
use taskito_core::scheduler::JobResult;
use taskito_core::worker::WorkerDispatcher;

use crate::task_executor::execute_sync_task;

/// Dual-dispatch worker pool: async tasks run natively on a Python event loop,
/// sync tasks use `spawn_blocking` (bounded by a semaphore).
pub struct NativeAsyncPool {
    num_workers: usize,
    task_registry: Arc<PyObject>,
    retry_filters: Arc<PyObject>,
    async_executor: Arc<PyObject>,
    shutdown: AtomicBool,
}

impl NativeAsyncPool {
    pub fn new(
        num_workers: usize,
        task_registry: Arc<PyObject>,
        retry_filters: Arc<PyObject>,
        async_executor: Arc<PyObject>,
    ) -> Self {
        Self {
            num_workers,
            task_registry,
            retry_filters,
            async_executor,
            shutdown: AtomicBool::new(false),
        }
    }
}

#[async_trait]
impl WorkerDispatcher for NativeAsyncPool {
    async fn run(
        &self,
        mut job_rx: tokio::sync::mpsc::Receiver<Job>,
        result_tx: Sender<JobResult>,
    ) {
        let semaphore = Arc::new(Semaphore::new(self.num_workers));

        while let Some(job) = job_rx.recv().await {
            if self.shutdown.load(Ordering::Relaxed) {
                break;
            }

            let is_async = Python::with_gil(|py| {
                let registry = self.task_registry.bind(py);
                if let Ok(dict) = registry.downcast::<pyo3::types::PyDict>() {
                    if let Ok(Some(wrapper)) = dict.get_item(&job.task_name) {
                        return wrapper
                            .getattr("_taskito_is_async")
                            .and_then(|v| v.extract::<bool>())
                            .unwrap_or(false);
                    }
                }
                false
            });

            if is_async {
                // Submit to the Python async executor — brief GIL hold, non-blocking
                let executor = self.async_executor.clone();
                Python::with_gil(|py| {
                    let exec = executor.bind(py);
                    let payload = PyBytes::new_bound(py, &job.payload);
                    if let Err(e) = exec.call_method1(
                        "submit_job",
                        (
                            &job.id,
                            &job.task_name,
                            payload,
                            job.retry_count,
                            job.max_retries,
                            &job.queue,
                        ),
                    ) {
                        eprintln!(
                            "[taskito] Failed to submit async task {}[{}]: {e}",
                            job.task_name, job.id
                        );
                        let _ = result_tx.send(JobResult::Failure {
                            job_id: job.id.clone(),
                            error: format!("async submit error: {e}"),
                            retry_count: job.retry_count,
                            max_retries: job.max_retries,
                            task_name: job.task_name.clone(),
                            wall_time_ns: 0,
                            should_retry: true,
                        });
                    }
                });
            } else {
                // Sync path: spawn_blocking bounded by semaphore
                let permit = match semaphore.clone().acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => break,
                };

                let registry = self.task_registry.clone();
                let filters = self.retry_filters.clone();
                let tx = result_tx.clone();

                tokio::task::spawn_blocking(move || {
                    let _permit = permit;
                    execute_sync_task(&registry, &filters, &job, &tx);
                });
            }
        }
    }

    fn shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }
}
