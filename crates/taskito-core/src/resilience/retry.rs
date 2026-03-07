use crate::job::now_millis;

/// Configuration for retry behavior.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// Maximum number of retries before moving to DLQ.
    pub max_retries: i32,
    /// Base delay in milliseconds for exponential backoff.
    pub base_delay_ms: i64,
    /// Maximum delay in milliseconds (cap).
    pub max_delay_ms: i64,
    /// Custom per-attempt delays in milliseconds. If set, overrides
    /// exponential backoff for the corresponding retry attempt.
    pub custom_delays_ms: Option<Vec<i64>>,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay_ms: 1_000,  // 1 second
            max_delay_ms: 300_000, // 5 minutes
            custom_delays_ms: None,
        }
    }
}

impl RetryPolicy {
    /// Calculate the next retry timestamp given the current retry count.
    /// Uses exponential backoff with jitter:
    ///   delay = min(max_delay, base_delay * 2^retry_count) + jitter
    /// where jitter is uniform in [0, base_delay).
    pub fn next_retry_at(&self, retry_count: i32) -> i64 {
        // Use custom delay if available for this retry attempt
        let delay = if let Some(ref delays) = self.custom_delays_ms {
            if let Some(&custom) = delays.get(retry_count as usize) {
                custom
            } else {
                // Fall back to exponential backoff if no custom delay for this attempt
                let exp = self
                    .base_delay_ms
                    .saturating_mul(1i64 << retry_count.min(30));
                exp.min(self.max_delay_ms)
            }
        } else {
            let exp = self
                .base_delay_ms
                .saturating_mul(1i64 << retry_count.min(30));
            exp.min(self.max_delay_ms)
        };

        let jitter = if self.base_delay_ms > 0 {
            (rand::random::<u64>() % self.base_delay_ms as u64) as i64
        } else {
            0
        };

        now_millis() + delay + jitter
    }

    /// Whether the job should be retried (retry_count < max_retries).
    pub fn should_retry(&self, retry_count: i32) -> bool {
        retry_count < self.max_retries
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_retry() {
        let policy = RetryPolicy {
            max_retries: 3,
            ..Default::default()
        };
        assert!(policy.should_retry(0));
        assert!(policy.should_retry(2));
        assert!(!policy.should_retry(3));
        assert!(!policy.should_retry(10));
    }

    #[test]
    fn test_next_retry_at_increases() {
        let policy = RetryPolicy {
            base_delay_ms: 1000,
            max_delay_ms: 60_000,
            max_retries: 5,
            custom_delays_ms: None,
        };

        // Retry 0 should give ~1s, retry 3 should give ~8s
        // We can't test exact values due to jitter, but we can test
        // that the delay grows and is bounded
        let now = now_millis();
        let t0 = policy.next_retry_at(0);
        let t3 = policy.next_retry_at(3);

        // Both should be in the future
        assert!(t0 > now);
        assert!(t3 > now);

        // t3's base delay (8s) should be larger than t0's base (1s)
        // But with jitter, we check a wider range
        assert!(t3 - now >= 8_000); // at least base_delay * 2^3
    }

    #[test]
    fn test_delay_capped() {
        let policy = RetryPolicy {
            base_delay_ms: 1000,
            max_delay_ms: 5_000,
            max_retries: 20,
            custom_delays_ms: None,
        };

        let now = now_millis();
        let t = policy.next_retry_at(15);
        // Should be capped at max_delay (5s) + jitter (up to 1s)
        assert!(t - now <= 6_100);
    }
}
