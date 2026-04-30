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
//! - One watchdog thread: enforces per-job timeouts by `SIGKILL`-ing children
//!   whose deadlines pass
//! - Child processes: run `python -m taskito.prefork <app_path>`

mod child;
mod dispatch;
pub mod protocol;
mod slot;
mod watchdog;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use crossbeam_channel::Sender;

use taskito_core::job::Job;
use taskito_core::scheduler::JobResult;
use taskito_core::worker::WorkerDispatcher;

use child::{spawn_child, ChildProcess, ChildReader, ChildWriter};
use protocol::ParentMessage;
use slot::{ActiveJob, SlotState};

/// How long graceful shutdown will wait for each child to drain before
/// sending `SIGKILL`.
const SHUTDOWN_DRAIN: Duration = Duration::from_secs(30);

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

        // Shared per-child state.
        let slots: SlotState = slot::new_slots(num_workers);
        let in_flight: Arc<Vec<AtomicU32>> =
            Arc::new((0..num_workers).map(|_| AtomicU32::new(0)).collect());
        let processes: Arc<Vec<Mutex<Option<ChildProcess>>>> =
            Arc::new((0..num_workers).map(|_| Mutex::new(None)).collect());

        // Per-child writers stay on the dispatch thread.
        let mut writers: Vec<Option<ChildWriter>> = (0..num_workers).map(|_| None).collect();
        let mut reader_handles: Vec<JoinHandle<()>> = Vec::new();

        // Initial spawn.
        for idx in 0..num_workers {
            if let Some(handle) = start_child(
                idx,
                &self.python,
                &self.app_path,
                &mut writers,
                &processes,
                &slots,
                &in_flight,
                &result_tx,
            ) {
                reader_handles.push(handle);
            }
        }

        if writers.iter().all(Option::is_none) {
            log::error!("[taskito] no prefork children started, aborting");
            return;
        }

        log::info!(
            "[taskito] prefork pool running with {} children",
            writers.iter().filter(|w| w.is_some()).count()
        );

        // Watchdog: kills children that exceed their per-job timeout.
        let watchdog_shutdown = Arc::new(AtomicBool::new(false));
        let watchdog_handle = watchdog::spawn(
            slots.clone(),
            processes.clone(),
            in_flight.clone(),
            result_tx.clone(),
            watchdog_shutdown.clone(),
        );

        // Dispatch loop.
        let mut restart_count: u64 = 0;
        while let Some(job) = job_rx.recv().await {
            if self.shutdown.load(Ordering::Relaxed) {
                break;
            }

            // Bring back any children that have exited (crashed, killed by
            // watchdog, OOM, etc.).
            for idx in 0..num_workers {
                let dead = match processes[idx].lock() {
                    Ok(mut guard) => match guard.as_mut() {
                        Some(p) => !p.is_alive(),
                        None => true,
                    },
                    Err(_) => false,
                };
                if dead {
                    log::warn!("[taskito] prefork child {idx} died, restarting");
                    restart_count += 1;
                    if let Some(handle) = start_child(
                        idx,
                        &self.python,
                        &self.app_path,
                        &mut writers,
                        &processes,
                        &slots,
                        &in_flight,
                        &result_tx,
                    ) {
                        reader_handles.push(handle);
                        log::info!(
                            "[taskito] prefork child {idx} restarted (total restarts: {restart_count})"
                        );
                    }
                }
            }

            let counts: Vec<u32> = in_flight
                .iter()
                .map(|c| c.load(Ordering::Relaxed))
                .collect();
            let idx = dispatch::least_loaded(&counts);

            let Some(writer) = writers[idx].as_mut() else {
                log::error!(
                    "[taskito] no live writer for child {idx}, dropping job {}; will be reaped",
                    job.id
                );
                continue;
            };

            let active = ActiveJob {
                job_id: job.id.clone(),
                task_name: job.task_name.clone(),
                retry_count: job.retry_count,
                max_retries: job.max_retries,
                timeout_ms: job.timeout_ms,
                started_at: Instant::now(),
                deadline: deadline_from_timeout(job.timeout_ms),
            };

            // Register *before* sending so a fast child can never publish a
            // result the reader can't pair with a slot entry.
            slot::set(&slots, idx, active);

            let msg = ParentMessage::from(&job);
            match writer.send(&msg) {
                Ok(()) => {
                    in_flight[idx].fetch_add(1, Ordering::Relaxed);
                }
                Err(e) => {
                    // Roll back the slot install — neither reader nor watchdog
                    // should fire for this aborted dispatch.
                    let _ = slot::take(&slots, idx);
                    log::error!(
                        "[taskito] failed to send job {} to child {idx}: {e}",
                        job.id
                    );
                    // Job will be reaped by the scheduler's stale-job reaper.
                }
            }
        }

        // Stop the watchdog before sending shutdown so it doesn't race with
        // children draining their final results.
        watchdog_shutdown.store(true, Ordering::SeqCst);

        // Graceful shutdown: tell all live children to stop.
        for (idx, writer) in writers.iter_mut().enumerate() {
            if let Some(w) = writer.as_mut() {
                w.send_shutdown();
                log::info!("[taskito] sent shutdown to prefork child {idx}");
            }
        }

        // Wait for children to exit (or kill after the drain timeout).
        for idx in 0..num_workers {
            if let Ok(mut guard) = processes[idx].lock() {
                if let Some(process) = guard.as_mut() {
                    process.wait_or_kill(SHUTDOWN_DRAIN);
                    log::info!("[taskito] prefork child {idx} exited");
                }
            }
        }

        // Reader threads exit when their child closes stdout.
        for handle in reader_handles {
            let _ = handle.join();
        }
        let _ = watchdog_handle.join();
    }

    fn shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }
}

/// Spawn child `idx` and its reader thread, plumbing the writer + process into
/// the shared state. Returns the reader thread handle on success, `None` on
/// spawn failure (already logged).
#[allow(clippy::too_many_arguments)]
fn start_child(
    idx: usize,
    python: &str,
    app_path: &str,
    writers: &mut [Option<ChildWriter>],
    processes: &Arc<Vec<Mutex<Option<ChildProcess>>>>,
    slots: &SlotState,
    in_flight: &Arc<Vec<AtomicU32>>,
    result_tx: &Sender<JobResult>,
) -> Option<JoinHandle<()>> {
    match spawn_child(python, app_path) {
        Ok((writer, reader, process)) => {
            log::info!("[taskito] prefork child {idx} ready");
            writers[idx] = Some(writer);
            if let Ok(mut slot) = processes[idx].lock() {
                *slot = Some(process);
            }
            // Reset the slot for the new child — the killed/dead one's job (if
            // any) was already completed by the watchdog or shutdown path.
            let _ = slot::take(slots, idx);
            in_flight[idx].store(0, Ordering::Relaxed);

            Some(spawn_reader_thread(
                idx,
                reader,
                slots.clone(),
                in_flight.clone(),
                result_tx.clone(),
            ))
        }
        Err(e) => {
            log::error!("[taskito] failed to spawn prefork child {idx}: {e}");
            None
        }
    }
}

/// Reader thread: forwards child results to the scheduler.
///
/// The slot acts as the ownership token — the reader emits a result *only* if
/// it can `take()` the slot entry first. If the watchdog has already taken
/// the slot (deadline expired), the reader silently drops the message because
/// the watchdog has already synthesised the timeout failure.
fn spawn_reader_thread(
    idx: usize,
    mut reader: ChildReader,
    slots: SlotState,
    in_flight: Arc<Vec<AtomicU32>>,
    result_tx: Sender<JobResult>,
) -> JoinHandle<()> {
    thread::Builder::new()
        .name(format!("taskito-prefork-reader-{idx}"))
        .spawn(move || loop {
            match reader.read() {
                Ok(msg) => {
                    let Some(job_result) = msg.into_job_result() else {
                        continue;
                    };
                    if slot::take(&slots, idx).is_none() {
                        // Watchdog already completed this job; drop the
                        // (now-redundant) child message.
                        continue;
                    }
                    in_flight[idx].fetch_sub(1, Ordering::Relaxed);
                    if result_tx.send(job_result).is_err() {
                        break; // result channel closed
                    }
                }
                Err(e) => {
                    log::warn!("[taskito] prefork child {idx} reader error: {e}");
                    break;
                }
            }
        })
        .expect("failed to spawn prefork reader thread")
}

/// Convert a per-task timeout in milliseconds to an absolute `Instant` deadline.
/// Returns `None` for `timeout_ms <= 0` (no timeout configured) so the watchdog
/// skips the slot.
fn deadline_from_timeout(timeout_ms: i64) -> Option<Instant> {
    if timeout_ms <= 0 {
        None
    } else {
        Instant::now().checked_add(Duration::from_millis(timeout_ms as u64))
    }
}
