//! Build core task/queue configuration from JS option inputs.

use taskito_core::resilience::rate_limiter::RateLimitConfig;
use taskito_core::resilience::retry::RetryPolicy;
use taskito_core::scheduler::{QueueConfig, TaskConfig};

use crate::config::{QueueConfigInput, TaskConfigInput};

const DEFAULT_RETRY_BASE_MS: i64 = 1_000;
const DEFAULT_RETRY_MAX_MS: i64 = 300_000;
const DEFAULT_MAX_RETRIES: i32 = 3;

/// Build a [`TaskConfig`] (retry policy, rate limit, concurrency cap) from JS input.
pub fn task_config(input: &TaskConfigInput) -> TaskConfig {
    TaskConfig {
        retry_policy: RetryPolicy {
            max_retries: input.max_retries.unwrap_or(DEFAULT_MAX_RETRIES),
            base_delay_ms: input.retry_base_delay_ms.unwrap_or(DEFAULT_RETRY_BASE_MS),
            max_delay_ms: input.retry_max_delay_ms.unwrap_or(DEFAULT_RETRY_MAX_MS),
            custom_delays_ms: None,
        },
        rate_limit: input.rate_limit.as_deref().and_then(RateLimitConfig::parse),
        circuit_breaker: None,
        max_concurrent: input.max_concurrent,
    }
}

/// Build a [`QueueConfig`] (rate limit, concurrency cap) from JS input.
pub fn queue_config(input: &QueueConfigInput) -> QueueConfig {
    QueueConfig {
        rate_limit: input.rate_limit.as_deref().and_then(RateLimitConfig::parse),
        max_concurrent: input.max_concurrent,
    }
}
