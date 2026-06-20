//! Build core task/queue configuration from JS option inputs.

use napi::bindgen_prelude::Result;
use taskito_core::resilience::rate_limiter::RateLimitConfig;
use taskito_core::resilience::retry::RetryPolicy;
use taskito_core::scheduler::{QueueConfig, TaskConfig};

use crate::config::{QueueConfigInput, TaskConfigInput};
use crate::error::invalid_arg;

const DEFAULT_RETRY_BASE_MS: i64 = 1_000;
const DEFAULT_RETRY_MAX_MS: i64 = 300_000;
const DEFAULT_MAX_RETRIES: i32 = 3;

/// Parse an optional rate-limit spec, failing fast on a malformed value rather
/// than silently disabling throttling (a misconfigured limit is a config error).
fn parse_rate_limit(spec: Option<&str>) -> Result<Option<RateLimitConfig>> {
    match spec {
        Some(s) => RateLimitConfig::parse(s)
            .map(Some)
            .ok_or_else(|| invalid_arg(format!("invalid rateLimit '{s}' (expected e.g. '100/m')"))),
        None => Ok(None),
    }
}

/// Build a [`TaskConfig`] (retry policy, rate limit, concurrency cap) from JS input.
pub fn task_config(input: &TaskConfigInput) -> Result<TaskConfig> {
    Ok(TaskConfig {
        retry_policy: RetryPolicy {
            max_retries: input.max_retries.unwrap_or(DEFAULT_MAX_RETRIES),
            base_delay_ms: input.retry_base_delay_ms.unwrap_or(DEFAULT_RETRY_BASE_MS),
            max_delay_ms: input.retry_max_delay_ms.unwrap_or(DEFAULT_RETRY_MAX_MS),
            custom_delays_ms: None,
        },
        rate_limit: parse_rate_limit(input.rate_limit.as_deref())?,
        circuit_breaker: None,
        max_concurrent: input.max_concurrent,
    })
}

/// Build a [`QueueConfig`] (rate limit, concurrency cap) from JS input.
pub fn queue_config(input: &QueueConfigInput) -> Result<QueueConfig> {
    Ok(QueueConfig {
        rate_limit: parse_rate_limit(input.rate_limit.as_deref())?,
        max_concurrent: input.max_concurrent,
    })
}
