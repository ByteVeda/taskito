use crate::job::now_millis;

/// Full Jitter (AWS "Exponential Backoff and Jitter"): a uniform random delay
/// in `[0, cap_ms]`. Drawing the *whole* delay from the range — rather than
/// adding a fixed jitter on top of a deterministic backoff — is what actually
/// spreads a wave of clients retrying the same failed downstream, because the
/// spread grows with the backoff instead of staying a fixed width. Returns 0
/// when `cap_ms <= 0`.
pub fn full_jitter(cap_ms: i64) -> i64 {
    if cap_ms <= 0 {
        return 0;
    }
    (rand::random::<u64>() % (cap_ms as u64 + 1)) as i64
}

/// A reschedule delay of `base_ms` with additive desync jitter on top
/// (`base_ms + [0, base_ms/2]`). Unlike [`full_jitter`], this keeps `base_ms`
/// as a floor — a gated job never re-attempts *sooner* than intended, so it
/// can't hammer the rate limiter / concurrency cap it just bounced off — while
/// still spreading many simultaneously-gated jobs so they don't retry in
/// lockstep on the next tick.
pub fn desync_delay(base_ms: i64) -> i64 {
    base_ms.saturating_add(full_jitter(base_ms / 2))
}

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
    ///
    /// Explicit `custom_delays_ms` are honored exactly — the caller asked for a
    /// specific schedule. Otherwise uses Full Jitter exponential backoff:
    ///   delay = uniform(0, min(max_delay, base_delay * 2^retry_count))
    /// so many jobs retrying the same failed downstream spread out instead of
    /// re-attempting in a synchronized wave. The cap still grows exponentially.
    pub fn next_retry_at(&self, retry_count: i32) -> i64 {
        if let Some(ref delays) = self.custom_delays_ms {
            if let Some(&custom) = delays.get(retry_count as usize) {
                return now_millis() + custom;
            }
        }

        let cap = self
            .base_delay_ms
            .saturating_mul(1i64 << retry_count.min(30))
            .min(self.max_delay_ms);

        now_millis() + full_jitter(cap)
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
    fn test_next_retry_at_bounded_by_growing_cap() {
        let policy = RetryPolicy {
            base_delay_ms: 1000,
            max_delay_ms: 60_000,
            max_retries: 5,
            custom_delays_ms: None,
        };

        // Full Jitter: each delay is in [0, cap(n)] where cap grows as
        // base * 2^n. We can't assert exact values, but every sample must
        // stay within its (exponentially growing) cap. Sample repeatedly so
        // the randomness is actually exercised.
        for _ in 0..1000 {
            let now = now_millis();
            let d0 = policy.next_retry_at(0) - now;
            let d3 = policy.next_retry_at(3) - now;
            assert!(
                (0..=1_000).contains(&d0),
                "retry 0 delay {d0} out of [0,1000]"
            );
            assert!(
                (0..=8_000).contains(&d3),
                "retry 3 delay {d3} out of [0,8000]"
            );
        }
    }

    #[test]
    fn test_delay_capped() {
        let policy = RetryPolicy {
            base_delay_ms: 1000,
            max_delay_ms: 5_000,
            max_retries: 20,
            custom_delays_ms: None,
        };

        // Full Jitter is capped at max_delay (5s) — never overshoots it.
        for _ in 0..1000 {
            let now = now_millis();
            let d = policy.next_retry_at(15) - now;
            assert!((0..=5_000).contains(&d), "capped delay {d} out of [0,5000]");
        }
    }

    #[test]
    fn test_custom_delays_honored_exactly() {
        let policy = RetryPolicy {
            base_delay_ms: 1000,
            max_delay_ms: 60_000,
            max_retries: 5,
            custom_delays_ms: Some(vec![2_000, 7_000]),
        };
        // Custom delays are exact (no jitter) — the caller asked for them.
        let now = now_millis();
        assert_eq!(policy.next_retry_at(0) - now, 2_000);
        assert_eq!(policy.next_retry_at(1) - now, 7_000);
        // Past the custom list, fall back to jittered exponential backoff.
        let d2 = policy.next_retry_at(2) - now_millis();
        assert!(
            (0..=4_000).contains(&d2),
            "fallback delay {d2} out of [0,4000]"
        );
    }

    #[test]
    fn test_full_jitter_bounds() {
        assert_eq!(full_jitter(0), 0);
        assert_eq!(full_jitter(-5), 0);
        for _ in 0..1000 {
            assert!((0..=100).contains(&full_jitter(100)));
        }
    }

    #[test]
    fn test_desync_delay_keeps_floor() {
        // Never sooner than base, never more than base * 1.5.
        for _ in 0..1000 {
            let d = desync_delay(1000);
            assert!(
                (1000..=1500).contains(&d),
                "desync delay {d} out of [1000,1500]"
            );
        }
        assert_eq!(desync_delay(0), 0);
    }
}
