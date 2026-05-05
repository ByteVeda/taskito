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

    /// Notify the pool that a running job should be cancelled.
    ///
    /// Pools that run tasks in-process (e.g. the thread pool) can rely on the
    /// storage cancel flag and provide a no-op. Pools that execute tasks in a
    /// separate process (e.g. the prefork pool) must use this hook to deliver
    /// a side-channel signal so the worker observes the cancel without polling
    /// storage.
    fn notify_cancel(&self, _job_id: &str) {}
}
