mod archival;
mod circuit_breakers;
mod dashboard_settings;
mod dead_letter;
mod jobs;
mod locks;
mod logs;
mod metrics;
mod periodic;
mod pubsub;
mod queue_state;
mod rate_limits;
mod trait_impl;
mod workers;

#[cfg(feature = "push-dispatch")]
pub mod listener;

use crate::error::{QueueError, Result};

/// Redis-backed storage for the task queue.
#[derive(Clone)]
pub struct RedisStorage {
    client: redis::Client,
    prefix: String,
}

impl RedisStorage {
    /// Connect to Redis at the given URL with default prefix `"taskito:"`.
    pub fn new(redis_url: &str) -> Result<Self> {
        Self::with_prefix(redis_url, "taskito:")
    }

    /// Connect with a custom key prefix.
    pub fn with_prefix(redis_url: &str, prefix: &str) -> Result<Self> {
        let client = redis::Client::open(redis_url)
            .map_err(|e| QueueError::Config(format!("Redis connection error: {e}")))?;

        // Validate the connection works
        let mut conn = client
            .get_connection()
            .map_err(|e| QueueError::Config(format!("Redis connection error: {e}")))?;
        redis::cmd("PING")
            .query::<String>(&mut conn)
            .map_err(|e| QueueError::Config(format!("Redis ping failed: {e}")))?;

        Ok(Self {
            client,
            prefix: prefix.to_string(),
        })
    }

    /// Build a Redis key from parts: `"{prefix}{part1}:{part2}:..."`.
    fn key(&self, parts: &[&str]) -> String {
        let mut k = self.prefix.clone();
        for (i, part) in parts.iter().enumerate() {
            if i > 0 {
                k.push(':');
            }
            k.push_str(part);
        }
        k
    }

    /// Get a Redis connection.
    pub fn conn(&self) -> Result<redis::Connection> {
        self.client
            .get_connection()
            .map_err(|e| QueueError::Other(format!("Redis connection error: {e}")))
    }

    /// The key prefix used for every Redis key this storage writes.
    ///
    /// Exposed so adjacent stores (e.g. the workflow store) can namespace
    /// their own keys under the same prefix without re-parsing the URL.
    pub fn prefix(&self) -> &str {
        &self.prefix
    }

    /// The single list key push-dispatch uses to signal ready jobs. The
    /// enqueue side `LPUSH`es a sentinel here; the listener `BLPOP`s it.
    #[cfg(feature = "push-dispatch")]
    pub(crate) fn notify_key(&self) -> String {
        self.key(&["notify", "_ready"])
    }

    /// A raw client clone, for the listener's dedicated blocking connection.
    #[cfg(feature = "push-dispatch")]
    pub fn client(&self) -> &redis::Client {
        &self.client
    }
}

#[cfg(feature = "push-dispatch")]
impl crate::storage::notify::StorageNotifier for RedisStorage {
    fn notify_job_ready(&self, _queue: &str, _scheduled_at: i64) {
        // Best-effort LPUSH of a sentinel onto the notify list. A failure only
        // costs the latency improvement — the fallback poll still dispatches.
        let mut conn = match self.conn() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("push-dispatch: redis notify conn failed: {e}");
                return;
            }
        };
        let key = self.notify_key();
        // Keep the list short — a single pending sentinel is enough to wake the
        // listener; trim so it can't grow unbounded under bursty enqueues.
        let res: redis::RedisResult<()> = redis::pipe()
            .lpush(&key, 1)
            .ltrim(&key, 0, 15)
            .query(&mut conn);
        if let Err(e) = res {
            log::warn!("push-dispatch: redis LPUSH notify failed: {e}");
        }
    }
}

fn map_err(e: redis::RedisError) -> QueueError {
    QueueError::Other(e.to_string())
}
