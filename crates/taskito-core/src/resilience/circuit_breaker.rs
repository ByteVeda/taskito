use crate::error::Result;
use crate::job::now_millis;
use crate::storage::models::CircuitBreakerRow;
use crate::storage::{Storage, StorageBackend};

/// Circuit breaker states.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum CircuitState {
    Closed = 0,
    Open = 1,
    HalfOpen = 2,
}

impl CircuitState {
    pub fn from_i32(v: i32) -> Self {
        match v {
            1 => Self::Open,
            2 => Self::HalfOpen,
            _ => Self::Closed,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Closed => "closed",
            Self::Open => "open",
            Self::HalfOpen => "half_open",
        }
    }
}

/// Configuration for a task's circuit breaker.
#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    pub threshold: i32,
    pub window_ms: i64,
    pub cooldown_ms: i64,
}

/// Circuit breaker manager backed by SQLite.
pub struct CircuitBreaker {
    storage: StorageBackend,
}

impl CircuitBreaker {
    pub fn new(storage: StorageBackend) -> Self {
        Self { storage }
    }

    /// Check if a task is allowed to execute. Returns true if allowed.
    /// Transitions Open -> HalfOpen after cooldown.
    pub fn allow(&self, task_name: &str) -> Result<bool> {
        let row = match self.storage.get_circuit_breaker(task_name)? {
            Some(r) => r,
            None => return Ok(true), // No breaker configured = always allow
        };

        let now = now_millis();
        let state = CircuitState::from_i32(row.state);

        match state {
            CircuitState::Closed => Ok(true),
            CircuitState::Open => {
                // Check if cooldown has elapsed
                let opened = row.opened_at.unwrap_or(0);
                if now - opened >= row.cooldown_ms {
                    // Transition to half-open: allow one probe
                    let updated = CircuitBreakerRow {
                        state: CircuitState::HalfOpen as i32,
                        half_open_at: Some(now),
                        ..row
                    };
                    self.storage.upsert_circuit_breaker(&updated)?;
                    Ok(true)
                } else {
                    Ok(false) // Still in cooldown
                }
            }
            CircuitState::HalfOpen => {
                // Only one probe at a time — block others
                Ok(false)
            }
        }
    }

    /// Record a task success. Resets the circuit breaker to closed.
    pub fn record_success(&self, task_name: &str) -> Result<()> {
        let row = match self.storage.get_circuit_breaker(task_name)? {
            Some(r) => r,
            None => return Ok(()),
        };

        let state = CircuitState::from_i32(row.state);
        if state == CircuitState::Closed && row.failure_count == 0 {
            return Ok(()); // Nothing to do
        }

        let updated = CircuitBreakerRow {
            state: CircuitState::Closed as i32,
            failure_count: 0,
            opened_at: None,
            half_open_at: None,
            ..row
        };
        self.storage.upsert_circuit_breaker(&updated)?;
        Ok(())
    }

    /// Record a task failure. May trip the breaker open.
    pub fn record_failure(&self, task_name: &str) -> Result<()> {
        let now = now_millis();

        let row = match self.storage.get_circuit_breaker(task_name)? {
            Some(r) => r,
            None => return Ok(()),
        };

        let state = CircuitState::from_i32(row.state);

        match state {
            CircuitState::HalfOpen => {
                // Probe failed — go back to open
                let updated = CircuitBreakerRow {
                    state: CircuitState::Open as i32,
                    failure_count: row.failure_count.saturating_add(1),
                    last_failure_at: Some(now),
                    opened_at: Some(now),
                    half_open_at: None,
                    ..row
                };
                self.storage.upsert_circuit_breaker(&updated)?;
            }
            CircuitState::Closed => {
                // Reset count if outside the window
                let count = if let Some(last) = row.last_failure_at {
                    if now - last > row.window_ms {
                        1 // Window expired, start fresh
                    } else {
                        row.failure_count.saturating_add(1)
                    }
                } else {
                    1
                };

                if count >= row.threshold {
                    // Trip to open
                    let updated = CircuitBreakerRow {
                        state: CircuitState::Open as i32,
                        failure_count: count,
                        last_failure_at: Some(now),
                        opened_at: Some(now),
                        half_open_at: None,
                        ..row
                    };
                    self.storage.upsert_circuit_breaker(&updated)?;
                } else {
                    let updated = CircuitBreakerRow {
                        failure_count: count,
                        last_failure_at: Some(now),
                        ..row
                    };
                    self.storage.upsert_circuit_breaker(&updated)?;
                }
            }
            CircuitState::Open => {
                // Already open, just update failure count
                let updated = CircuitBreakerRow {
                    failure_count: row.failure_count.saturating_add(1),
                    last_failure_at: Some(now),
                    ..row
                };
                self.storage.upsert_circuit_breaker(&updated)?;
            }
        }

        Ok(())
    }

    /// Register a circuit breaker for a task (idempotent).
    pub fn register(&self, task_name: &str, config: &CircuitBreakerConfig) -> Result<()> {
        if self.storage.get_circuit_breaker(task_name)?.is_some() {
            return Ok(());
        }

        let row = CircuitBreakerRow {
            task_name: task_name.to_string(),
            state: CircuitState::Closed as i32,
            failure_count: 0,
            last_failure_at: None,
            opened_at: None,
            half_open_at: None,
            threshold: config.threshold,
            window_ms: config.window_ms,
            cooldown_ms: config.cooldown_ms,
        };
        self.storage.upsert_circuit_breaker(&row)?;
        Ok(())
    }
}
