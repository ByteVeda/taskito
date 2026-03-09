use async_trait::async_trait;
use crossbeam_channel::Sender;

use crate::job::Job;
use crate::scheduler::JobResult;

/// Abstraction for worker pool implementations.
/// Core defines the interface; language-specific crates provide implementations.
#[async_trait]
pub trait WorkerDispatcher: Send + Sync {
    /// Start dispatching jobs from the receiver. Runs until channel closes.
    async fn run(&self, job_rx: tokio::sync::mpsc::Receiver<Job>, result_tx: Sender<JobResult>);

    /// Signal the pool to stop accepting new work.
    fn shutdown(&self);
}
