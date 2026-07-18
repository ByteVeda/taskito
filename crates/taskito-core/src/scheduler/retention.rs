//! Per-table retention windows.
//!
//! How long each history table keeps a row before auto-cleanup deletes it.
//! Named per *table*, never `result_ttl_ms` — that name already means the
//! per-entry TTL a single job or DLQ entry can carry, which is honored
//! independently of any window here.

const DAY_MS: i64 = 86_400_000;

/// Recommended default windows, applied when a queue configures no retention at
/// all. Ordered by the invariant
/// `task_logs ≤ archived_jobs = job_errors = task_metrics ≤ dead_letter`:
/// logs churn hardest and are worth least (shortest); the DLQ is the only copy
/// of a payload a human must act on, so it is deleted last (longest).
pub const DEFAULT_ARCHIVED_JOBS_TTL_MS: i64 = 7 * DAY_MS;
pub const DEFAULT_DEAD_LETTER_TTL_MS: i64 = 30 * DAY_MS;
pub const DEFAULT_TASK_LOGS_TTL_MS: i64 = 3 * DAY_MS;
pub const DEFAULT_TASK_METRICS_TTL_MS: i64 = 7 * DAY_MS;
pub const DEFAULT_JOB_ERRORS_TTL_MS: i64 = 7 * DAY_MS;

/// Retention window per history table, in milliseconds. `None` keeps a table
/// forever.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RetentionConfig {
    /// Terminal jobs (`archived_jobs`) — the artifact `get_job` reads after
    /// completion. Covers every terminal status.
    pub archived_jobs_ttl_ms: Option<i64>,
    /// Dead-letter entries. The only copy of a payload a human must act on, so
    /// deliberately the longest-lived by default.
    pub dead_letter_ttl_ms: Option<i64>,
    /// Task logs — highest write volume, lowest per-row value.
    pub task_logs_ttl_ms: Option<i64>,
    /// Task metrics — feeds the dashboard charts.
    pub task_metrics_ttl_ms: Option<i64>,
    /// Per-attempt job errors.
    pub job_errors_ttl_ms: Option<i64>,
}

impl RetentionConfig {
    /// Every table set to the same window. This is exactly what the deprecated
    /// queue-wide `result_ttl_ms` meant, so the legacy knob maps onto it losslessly.
    pub fn uniform(ttl_ms: i64) -> Self {
        Self {
            archived_jobs_ttl_ms: Some(ttl_ms),
            dead_letter_ttl_ms: Some(ttl_ms),
            task_logs_ttl_ms: Some(ttl_ms),
            task_metrics_ttl_ms: Some(ttl_ms),
            job_errors_ttl_ms: Some(ttl_ms),
        }
    }

    /// The recommended default windows, applied when a queue sets no retention.
    /// See the module-level `DEFAULT_*_TTL_MS` constants and their invariant.
    pub fn recommended() -> Self {
        Self {
            archived_jobs_ttl_ms: Some(DEFAULT_ARCHIVED_JOBS_TTL_MS),
            dead_letter_ttl_ms: Some(DEFAULT_DEAD_LETTER_TTL_MS),
            task_logs_ttl_ms: Some(DEFAULT_TASK_LOGS_TTL_MS),
            task_metrics_ttl_ms: Some(DEFAULT_TASK_METRICS_TTL_MS),
            job_errors_ttl_ms: Some(DEFAULT_JOB_ERRORS_TTL_MS),
        }
    }

    /// True when no table has a window — auto-cleanup only runs the per-entry
    /// TTL sweeps.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// A copy with every negative window dropped to `None`. A negative window
    /// would invert the cutoff into the future (`now - (-ttl)`) and match every
    /// row, so it is treated as "no window" rather than a mass delete.
    pub fn sanitized(&self) -> Self {
        let keep = |ttl: Option<i64>| ttl.filter(|t| *t >= 0);
        Self {
            archived_jobs_ttl_ms: keep(self.archived_jobs_ttl_ms),
            dead_letter_ttl_ms: keep(self.dead_letter_ttl_ms),
            task_logs_ttl_ms: keep(self.task_logs_ttl_ms),
            task_metrics_ttl_ms: keep(self.task_metrics_ttl_ms),
            job_errors_ttl_ms: keep(self.job_errors_ttl_ms),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recommended_respects_the_ordering_invariant() {
        let r = RetentionConfig::recommended();
        let logs = r.task_logs_ttl_ms.unwrap();
        let archived = r.archived_jobs_ttl_ms.unwrap();
        let errors = r.job_errors_ttl_ms.unwrap();
        let metrics = r.task_metrics_ttl_ms.unwrap();
        let dlq = r.dead_letter_ttl_ms.unwrap();

        // task_logs ≤ archived_jobs = job_errors = task_metrics ≤ dead_letter.
        assert!(logs <= archived, "logs must not outlive their archived job");
        assert_eq!(archived, errors, "job_errors backs its archived job");
        assert_eq!(archived, metrics, "metrics must outlive their charted job");
        assert!(
            archived <= dlq,
            "the DLQ is the longest-lived, deliberately"
        );
        assert!(!r.is_empty(), "the recommended windows are not empty");
    }
}
