mod archival;
mod circuit_breakers;
mod dead_letter;
mod jobs;
mod logs;
mod metrics;
mod periodic;
mod queue_state;
mod rate_limits;
mod trait_impl;
mod workers;

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
    fn conn(&self) -> Result<redis::Connection> {
        self.client
            .get_connection()
            .map_err(|e| QueueError::Other(format!("Redis connection error: {e}")))
    }
}

fn map_err(e: redis::RedisError) -> QueueError {
    QueueError::Other(e.to_string())
}
