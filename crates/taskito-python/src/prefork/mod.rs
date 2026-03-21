//! Prefork worker pool — dispatches jobs to child Python processes via IPC.
//!
//! Each child is an independent Python interpreter with its own GIL,
//! enabling true parallelism for CPU-bound tasks. The parent process
//! runs the Rust scheduler and dispatches serialized jobs over stdin
//! pipes; children send results back over stdout pipes.
//!
//! Architecture:
//! - One dispatch thread: receives `Job` from scheduler, sends to children via stdin
//! - N reader threads: one per child, reads results from stdout, sends to `result_tx`
//! - Child processes: run `python -m taskito.prefork <app_path>`

mod child;
mod dispatch;
pub mod protocol;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;

use async_trait::async_trait;
use crossbeam_channel::Sender;

use taskito_core::job::Job;
use taskito_core::scheduler::JobResult;
use taskito_core::worker::WorkerDispatcher;

use child::{spawn_child, ChildWriter};
use protocol::ParentMessage;

/// Multi-process worker pool that dispatches jobs to child Python processes.
pub struct PreforkPool {
    num_workers: usize,
    app_path: String,
    python: String,
    shutdown: AtomicBool,
}

impl PreforkPool {
    pub fn new(num_workers: usize, app_path: String) -> Self {
        let python = std::env::var("TASKITO_PYTHON").unwrap_or_else(|_| "python".to_string());

        Self {
            num_workers,
            app_path,
            python,
            shutdown: AtomicBool::new(false),
        }
    }
}

#[async_trait]
impl WorkerDispatcher for PreforkPool {
    async fn run(
        &self,
        mut job_rx: tokio::sync::mpsc::Receiver<Job>,
        result_tx: Sender<JobResult>,
    ) {
        let num_workers = self.num_workers;
        let app_path = self.app_path.clone();
        let python = self.python.clone();
        let shutdown = &self.shutdown;

        // Spawn all children and split into writers + readers
        let mut writers: Vec<ChildWriter> = Vec::with_capacity(num_workers);
        let in_flight: Arc<Vec<AtomicU32>> =
            Arc::new((0..num_workers).map(|_| AtomicU32::new(0)).collect());
        let mut reader_handles: Vec<thread::JoinHandle<()>> = Vec::new();
        let mut process_handles: Vec<child::ChildProcess> = Vec::new();

        for i in 0..num_workers {
            match spawn_child(&python, &app_path) {
                Ok((writer, mut reader, process)) => {
                    log::info!("[taskito] prefork child {i} ready");
                    writers.push(writer);
                    process_handles.push(process);

                    // Spawn a reader thread for this child
                    let tx = result_tx.clone();
                    let in_flight_counter = in_flight.clone();
                    let child_idx = i;
                    reader_handles.push(thread::spawn(move || {
                        loop {
                            match reader.read() {
                                Ok(msg) => {
                                    if let Some(job_result) = msg.into_job_result() {
                                        in_flight_counter[child_idx]
                                            .fetch_sub(1, Ordering::Relaxed);
                                        if tx.send(job_result).is_err() {
                                            break; // result channel closed
                                        }
                                    }
                                }
                                Err(e) => {
                                    log::warn!(
                                        "[taskito] prefork child {child_idx} reader error: {e}"
                                    );
                                    break;
                                }
                            }
                        }
                    }));
                }
                Err(e) => {
                    log::error!("[taskito] failed to spawn prefork child {i}: {e}");
                }
            }
        }

        if writers.is_empty() {
            log::error!("[taskito] no prefork children started, aborting");
            return;
        }

        log::info!(
            "[taskito] prefork pool running with {} children",
            writers.len()
        );

        // Dispatch loop: receive jobs from scheduler, send to least-loaded child
        while let Some(job) = job_rx.recv().await {
            if shutdown.load(Ordering::Relaxed) {
                break;
            }

            let counts: Vec<u32> = in_flight
                .iter()
                .map(|c| c.load(Ordering::Relaxed))
                .collect();
            let idx = dispatch::least_loaded(&counts);

            let msg = ParentMessage::from(&job);
            if let Err(e) = writers[idx].send(&msg) {
                log::error!(
                    "[taskito] failed to send job {} to child {idx}: {e}",
                    job.id
                );
                // Job will be reaped by the scheduler's stale job reaper
                continue;
            }
            in_flight[idx].fetch_add(1, Ordering::Relaxed);
        }

        // Graceful shutdown: tell all children to stop
        for (i, writer) in writers.iter_mut().enumerate() {
            writer.send_shutdown();
            log::info!("[taskito] sent shutdown to prefork child {i}");
        }

        // Wait for children to exit
        let drain_timeout = std::time::Duration::from_secs(30);
        for (i, process) in process_handles.iter_mut().enumerate() {
            process.wait_or_kill(drain_timeout);
            log::info!("[taskito] prefork child {i} exited");
        }

        // Wait for reader threads
        for handle in reader_handles {
            let _ = handle.join();
        }
    }

    fn shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }
}
