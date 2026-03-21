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
    /// Number of probe requests allowed in HalfOpen state (default: 5).
    pub half_open_max_probes: i32,
    /// Required success rate (0.0–1.0) to close from HalfOpen (default: 0.8 = 80%).
    pub half_open_success_rate: f64,
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
                if now.saturating_sub(opened) >= row.cooldown_ms {
                    // Transition to half-open: reset probe counters
                    let updated = CircuitBreakerRow {
                        state: CircuitState::HalfOpen as i32,
                        half_open_at: Some(now),
                        half_open_probe_count: 0,
                        half_open_success_count: 0,
                        half_open_failure_count: 0,
                        ..row
                    };
                    self.storage.upsert_circuit_breaker(&updated)?;
                    Ok(true)
                } else {
                    Ok(false) // Still in cooldown
                }
            }
            CircuitState::HalfOpen => {
                // Allow up to max_probes concurrent probes
                if row.half_open_probe_count < row.half_open_max_probes {
                    let updated = CircuitBreakerRow {
                        half_open_probe_count: row.half_open_probe_count + 1,
                        ..row
                    };
                    self.storage.upsert_circuit_breaker(&updated)?;
                    Ok(true)
                } else {
                    // Check for timeout: if probes haven't completed within cooldown, re-open
                    let half_open_since = row.half_open_at.unwrap_or(0);
                    if now.saturating_sub(half_open_since) >= row.cooldown_ms {
                        let updated = CircuitBreakerRow {
                            state: CircuitState::Open as i32,
                            opened_at: Some(now),
                            half_open_at: None,
                            half_open_probe_count: 0,
                            half_open_success_count: 0,
                            half_open_failure_count: 0,
                            ..row
                        };
                        self.storage.upsert_circuit_breaker(&updated)?;
                    }
                    Ok(false)
                }
            }
        }
    }

    /// Record a task success. In HalfOpen, tracks probes and closes when
    /// the success rate threshold is met.
    pub fn record_success(&self, task_name: &str) -> Result<()> {
        let row = match self.storage.get_circuit_breaker(task_name)? {
            Some(r) => r,
            None => return Ok(()),
        };

        let state = CircuitState::from_i32(row.state);

        match state {
            CircuitState::Closed if row.failure_count == 0 => Ok(()),
            CircuitState::HalfOpen => {
                let successes = row.half_open_success_count + 1;
                let total = successes + row.half_open_failure_count;

                if total >= row.half_open_max_probes {
                    let rate = successes as f64 / total as f64;
                    if rate >= row.half_open_success_rate {
                        // Threshold met — close the circuit
                        let updated = CircuitBreakerRow {
                            state: CircuitState::Closed as i32,
                            failure_count: 0,
                            opened_at: None,
                            half_open_at: None,
                            half_open_probe_count: 0,
                            half_open_success_count: 0,
                            half_open_failure_count: 0,
                            ..row
                        };
                        self.storage.upsert_circuit_breaker(&updated)?;
                    } else {
                        // Threshold not met — re-open
                        let now = now_millis();
                        let updated = CircuitBreakerRow {
                            state: CircuitState::Open as i32,
                            opened_at: Some(now),
                            half_open_at: None,
                            half_open_probe_count: 0,
                            half_open_success_count: 0,
                            half_open_failure_count: 0,
                            ..row
                        };
                        self.storage.upsert_circuit_breaker(&updated)?;
                    }
                } else {
                    // Still collecting samples
                    let updated = CircuitBreakerRow {
                        half_open_success_count: successes,
                        ..row
                    };
                    self.storage.upsert_circuit_breaker(&updated)?;
                }
                Ok(())
            }
            _ => {
                // Closed with failures or Open — reset to clean Closed
                let updated = CircuitBreakerRow {
                    state: CircuitState::Closed as i32,
                    failure_count: 0,
                    opened_at: None,
                    half_open_at: None,
                    half_open_probe_count: 0,
                    half_open_success_count: 0,
                    half_open_failure_count: 0,
                    ..row
                };
                self.storage.upsert_circuit_breaker(&updated)?;
                Ok(())
            }
        }
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
                let failures = row.half_open_failure_count + 1;
                let total = row.half_open_success_count + failures;

                // Check if the success rate can still be met
                let remaining = row.half_open_max_probes - total;
                let best_possible_rate = if row.half_open_max_probes > 0 {
                    (row.half_open_success_count + remaining) as f64
                        / row.half_open_max_probes as f64
                } else {
                    0.0
                };

                if total >= row.half_open_max_probes
                    || best_possible_rate < row.half_open_success_rate
                {
                    // Either all samples collected and failed, or impossible to meet threshold
                    let updated = CircuitBreakerRow {
                        state: CircuitState::Open as i32,
                        failure_count: row.failure_count.saturating_add(1),
                        last_failure_at: Some(now),
                        opened_at: Some(now),
                        half_open_at: None,
                        half_open_probe_count: 0,
                        half_open_success_count: 0,
                        half_open_failure_count: 0,
                        ..row
                    };
                    self.storage.upsert_circuit_breaker(&updated)?;
                } else {
                    // Still collecting samples
                    let updated = CircuitBreakerRow {
                        failure_count: row.failure_count.saturating_add(1),
                        last_failure_at: Some(now),
                        half_open_failure_count: failures,
                        ..row
                    };
                    self.storage.upsert_circuit_breaker(&updated)?;
                }
            }
            CircuitState::Closed => {
                // Reset count if outside the window
                let count = if let Some(last) = row.last_failure_at {
                    if now.saturating_sub(last) > row.window_ms {
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
            half_open_max_probes: config.half_open_max_probes,
            half_open_success_rate: config.half_open_success_rate,
            half_open_probe_count: 0,
            half_open_success_count: 0,
            half_open_failure_count: 0,
        };
        self.storage.upsert_circuit_breaker(&row)?;
        Ok(())
    }
}
