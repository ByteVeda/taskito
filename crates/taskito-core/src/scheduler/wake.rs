//! Wake sources for the scheduler loop.
//!
//! Entirely behind the `push-dispatch` feature. When the feature is off this
//! module is not compiled and the scheduler keeps its original adaptive-poll
//! loop unchanged.
//!
//! A [`WakeSource`] lets an enqueue (or retry, or periodic enqueue) wake the
//! scheduler immediately instead of waiting for the next poll tick. Polling is
//! retained as a safety-net fallback so a missed notification can never strand
//! a job.

#![cfg(feature = "push-dispatch")]

use std::sync::Arc;

use tokio::sync::{mpsc, Notify};

/// Where the scheduler gets its "a job is ready" signals from.
pub enum WakeSource {
    /// SQLite, single-process: an in-memory [`Notify`] shared with the
    /// storage layer. Enqueue calls `notify_one()` on the same handle.
    InProcess(Arc<Notify>),
    /// Postgres `LISTEN` / Redis `BLPOP`: a background listener forwards a
    /// unit value per notification into this channel.
    Channel(mpsc::Receiver<()>),
    /// Feature compiled in but no wake source available — behaves like the
    /// fallback timer alone (the loop still dispatches on its periodic tick).
    Polling,
}

impl WakeSource {
    /// Wait for the next wake signal.
    ///
    /// For [`WakeSource::Polling`] this never resolves on its own — the
    /// scheduler's fallback `sleep` timer drives dispatch instead, so this
    /// arm must simply yield the loop's `select!` to the timer.
    pub async fn wait(&mut self) {
        match self {
            WakeSource::InProcess(notify) => notify.notified().await,
            WakeSource::Channel(rx) => {
                // A closed channel (listener gone) must not busy-loop the
                // select!; fall back to never-resolving so the timer drives.
                if rx.recv().await.is_none() {
                    std::future::pending::<()>().await
                }
            }
            WakeSource::Polling => std::future::pending::<()>().await,
        }
    }
}
