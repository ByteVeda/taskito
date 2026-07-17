//! Per-table retention windows.
//!
//! How long each history table keeps a row before auto-cleanup deletes it.
//! Named per *table*, never `result_ttl_ms` — that name already means the
//! per-entry TTL a single job or DLQ entry can carry, which is honored
//! independently of any window here.

/// Retention window per history table, in milliseconds. `None` keeps a table
/// forever.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RetentionConfig {
    /// Terminal jobs (`archived_jobs`) — the artifact `get_job` reads after
    /// completion. Covers every status on the Diesel backends; Redis currently
    /// purges only `Complete` archive rows (pending its ZSET-drain rewrite).
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
