//! Per-table retention windows.
//!
//! How long each history table keeps a row before auto-cleanup deletes it.
//! Named per *table*, never `result_ttl_ms` — that name already means the
//! per-entry TTL a single job or DLQ entry can carry, which is honored
//! independently of any window here.

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::storage::Storage;

const DAY_MS: i64 = 86_400_000;

/// Namespace label used when a queue runs unnamespaced.
pub const DEFAULT_NAMESPACE: &str = "default";

/// Settings-key prefix under which the elected retention leader publishes the
/// windows it applies, one key per namespace. Dashboards read it to echo the
/// live policy; the shells treat the prefix as reserved so it can neither be
/// listed as an editable setting nor spoofed through the settings API.
pub const RETENTION_SETTING_PREFIX: &str = "retention:effective:";

/// Recommended default windows, applied when a queue configures no retention at
/// all. Ordered by the invariant
/// `task_logs ≤ archived_jobs = job_errors = task_metrics ≤ dead_letter`:
/// logs churn hardest and are worth least (shortest); the DLQ is the only copy
/// of a payload a human must act on, so it is deleted last (longest).
pub const DEFAULT_ARCHIVED_JOBS_TTL_MS: i64 = 7 * DAY_MS;
/// Default `dead_letter` window: 30 days, in milliseconds.
pub const DEFAULT_DEAD_LETTER_TTL_MS: i64 = 30 * DAY_MS;
/// Default `task_logs` window: 3 days, in milliseconds.
pub const DEFAULT_TASK_LOGS_TTL_MS: i64 = 3 * DAY_MS;
/// Default `task_metrics` window: 7 days, in milliseconds.
pub const DEFAULT_TASK_METRICS_TTL_MS: i64 = 7 * DAY_MS;
/// Default `job_errors` window: 7 days, in milliseconds.
pub const DEFAULT_JOB_ERRORS_TTL_MS: i64 = 7 * DAY_MS;

/// Retention window per history table, in milliseconds. `None` keeps a table
/// forever.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
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

/// What the elected retention leader is actually applying, as published for
/// dashboards to echo. Windows are milliseconds; a `null` window keeps that
/// table forever.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EffectiveRetention {
    /// False when no table has a window — only per-entry TTLs are swept.
    pub enabled: bool,
    /// True when the windows are the recommended defaults because the operator
    /// configured nothing.
    pub defaulted: bool,
    /// Namespace the windows apply to. The purges are not queue-scoped, so they
    /// cover every queue in this namespace.
    pub namespace: String,
    /// When the leader last published this document, in Unix milliseconds.
    pub reported_at: i64,
    /// The windows themselves.
    pub windows: RetentionConfig,
}

/// Settings key holding the published windows for `namespace`.
pub fn retention_setting_key(namespace: Option<&str>) -> String {
    format!(
        "{RETENTION_SETTING_PREFIX}{}",
        namespace.unwrap_or(DEFAULT_NAMESPACE)
    )
}

/// Publish the windows this leader applies so any dashboard can echo the live
/// policy instead of guessing at the defaults.
pub fn publish_effective_retention<S: Storage>(
    storage: &S,
    namespace: Option<&str>,
    snapshot: &EffectiveRetention,
) -> Result<()> {
    let json = serde_json::to_string(snapshot)?;
    storage.set_setting(&retention_setting_key(namespace), &json)
}

/// The windows last published for `namespace`, or `None` when no leader has
/// reported yet — the state a dashboard sees before the first cleanup sweep.
/// An unparseable document reads as unreported rather than failing the caller.
pub fn read_effective_retention<S: Storage>(
    storage: &S,
    namespace: Option<&str>,
) -> Result<Option<EffectiveRetention>> {
    let Some(raw) = storage.get_setting(&retention_setting_key(namespace))? else {
        return Ok(None);
    };
    Ok(serde_json::from_str(&raw).ok())
}

/// The published document for `namespace` as JSON, re-encoded from the parsed
/// form so a shell never forwards a malformed body. `None` when unreported.
pub fn read_effective_retention_json<S: Storage>(
    storage: &S,
    namespace: Option<&str>,
) -> Result<Option<String>> {
    read_effective_retention(storage, namespace)?
        .map(|snapshot| serde_json::to_string(&snapshot).map_err(Into::into))
        .transpose()
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

    #[test]
    fn setting_key_is_namespaced() {
        assert_eq!(
            retention_setting_key(Some("tenant-a")),
            "retention:effective:tenant-a"
        );
        // An unnamespaced queue publishes under the same label the cleanup
        // announcement uses, so the two always name the same thing.
        assert_eq!(
            retention_setting_key(None),
            "retention:effective:default".to_string()
        );
    }

    #[test]
    fn published_document_round_trips() {
        let snapshot = EffectiveRetention {
            enabled: true,
            defaulted: false,
            namespace: DEFAULT_NAMESPACE.to_string(),
            reported_at: 1_753_200_000_000,
            windows: RetentionConfig {
                archived_jobs_ttl_ms: Some(DAY_MS),
                ..RetentionConfig::default()
            },
        };

        let json = serde_json::to_string(&snapshot).unwrap();
        assert_eq!(
            serde_json::from_str::<EffectiveRetention>(&json).unwrap(),
            snapshot
        );
        // A window that keeps its table forever must survive as an explicit
        // null — a shell reads absent and null identically.
        assert!(json.contains("\"dead_letter_ttl_ms\":null"));
    }
}
