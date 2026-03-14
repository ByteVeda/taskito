use crossbeam_channel::Sender;
use pyo3::prelude::*;

use taskito_core::scheduler::JobResult;

/// Python-accessible sender for reporting task results back to the Rust scheduler.
///
/// The `AsyncTaskExecutor` on the Python side calls `report_success`, `report_failure`,
/// or `report_cancelled` to push `JobResult` values into the same crossbeam channel
/// that sync tasks use.
#[pyclass]
pub struct PyResultSender {
    tx: Sender<JobResult>,
}

impl PyResultSender {
    pub fn new(tx: Sender<JobResult>) -> Self {
        Self { tx }
    }
}

#[pymethods]
impl PyResultSender {
    /// Report a successful task execution.
    #[pyo3(signature = (job_id, task_name, result, wall_time_ns))]
    fn report_success(
        &self,
        job_id: String,
        task_name: String,
        result: Option<Vec<u8>>,
        wall_time_ns: i64,
    ) {
        let _ = self.tx.send(JobResult::Success {
            job_id,
            result,
            task_name,
            wall_time_ns,
        });
    }

    /// Report a failed task execution.
    #[pyo3(signature = (job_id, task_name, error, retry_count, max_retries, wall_time_ns, should_retry))]
    #[allow(clippy::too_many_arguments)]
    fn report_failure(
        &self,
        job_id: String,
        task_name: String,
        error: String,
        retry_count: i32,
        max_retries: i32,
        wall_time_ns: i64,
        should_retry: bool,
    ) {
        let _ = self.tx.send(JobResult::Failure {
            job_id,
            error,
            retry_count,
            max_retries,
            task_name,
            wall_time_ns,
            should_retry,
            timed_out: false,
        });
    }

    /// Report a cancelled task.
    #[pyo3(signature = (job_id, task_name, wall_time_ns))]
    fn report_cancelled(&self, job_id: String, task_name: String, wall_time_ns: i64) {
        let _ = self.tx.send(JobResult::Cancelled {
            job_id,
            task_name,
            wall_time_ns,
        });
    }
}
