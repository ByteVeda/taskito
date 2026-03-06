use crate::error::Result;
use crate::job::now_millis;
use crate::storage::models::RateLimitRow;
use crate::storage::sqlite::SqliteStorage;

/// Token bucket rate limiter backed by SQLite for persistence.
pub struct RateLimiter {
    storage: SqliteStorage,
}

/// Parsed rate limit configuration (e.g., "100/m" → 100 tokens, refill 1.667/s).
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    pub max_tokens: f64,
    pub refill_rate: f64, // tokens per second
}

impl RateLimitConfig {
    /// Parse a rate limit string like "100/s", "100/m", "1000/h".
    pub fn parse(s: &str) -> Option<Self> {
        let parts: Vec<&str> = s.split('/').collect();
        if parts.len() != 2 {
            return None;
        }

        let count: f64 = parts[0].trim().parse().ok()?;
        let refill_rate = match parts[1].trim() {
            "s" | "sec" | "second" => count,
            "m" | "min" | "minute" => count / 60.0,
            "h" | "hr" | "hour" => count / 3600.0,
            _ => return None,
        };

        Some(Self {
            max_tokens: count,
            refill_rate,
        })
    }
}

impl RateLimiter {
    pub fn new(storage: SqliteStorage) -> Self {
        Self { storage }
    }

    /// Try to acquire a token for the given key.
    /// Returns `true` if the token was acquired, `false` if rate limited.
    pub fn try_acquire(&self, key: &str, config: &RateLimitConfig) -> Result<bool> {
        let now = now_millis();

        let mut row = match self.storage.get_rate_limit(key)? {
            Some(row) => row,
            None => {
                // First time: initialize with full bucket
                RateLimitRow {
                    key: key.to_string(),
                    tokens: config.max_tokens,
                    max_tokens: config.max_tokens,
                    refill_rate: config.refill_rate,
                    last_refill: now,
                }
            }
        };

        // Refill tokens based on elapsed time
        let elapsed_ms = (now - row.last_refill).max(0) as f64;
        let elapsed_sec = elapsed_ms / 1000.0;
        let refilled = row.tokens + elapsed_sec * config.refill_rate;
        row.tokens = refilled.min(config.max_tokens);
        row.last_refill = now;

        // Try to consume one token
        if row.tokens >= 1.0 {
            row.tokens -= 1.0;
            self.storage.upsert_rate_limit(&row)?;
            Ok(true)
        } else {
            self.storage.upsert_rate_limit(&row)?;
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rate_limit() {
        let config = RateLimitConfig::parse("100/m").unwrap();
        assert!((config.max_tokens - 100.0).abs() < f64::EPSILON);
        assert!((config.refill_rate - 100.0 / 60.0).abs() < 0.01);

        let config = RateLimitConfig::parse("50/s").unwrap();
        assert!((config.refill_rate - 50.0).abs() < f64::EPSILON);

        let config = RateLimitConfig::parse("3600/h").unwrap();
        assert!((config.refill_rate - 1.0).abs() < f64::EPSILON);

        assert!(RateLimitConfig::parse("invalid").is_none());
    }

    #[test]
    fn test_token_bucket() {
        let storage = SqliteStorage::in_memory().unwrap();
        let limiter = RateLimiter::new(storage);
        let config = RateLimitConfig {
            max_tokens: 3.0,
            refill_rate: 1.0,
        };

        // Should allow 3 acquires (bucket starts full)
        assert!(limiter.try_acquire("test", &config).unwrap());
        assert!(limiter.try_acquire("test", &config).unwrap());
        assert!(limiter.try_acquire("test", &config).unwrap());

        // 4th should be denied
        assert!(!limiter.try_acquire("test", &config).unwrap());
    }
}
