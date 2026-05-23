use std::fmt;

use serde::{Deserialize, Serialize};

/// State machine for a workflow run.
///
/// Transitions:
///   Pending      → Running
///   Running      → Completed | Failed | Cancelled | Paused | Compensating
///   Paused       → Running | Cancelled
///   Compensating → Compensated | CompensationFailed
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowState {
    Pending,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
    /// A saga-mode run that has hit a forward failure and is rolling back
    /// previously-completed nodes via their compensation tasks.
    Compensating,
    /// All compensations succeeded — the run is fully rolled back.
    Compensated,
    /// At least one compensation failed. Partial rollback may be in effect.
    CompensationFailed,
}

impl WorkflowState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Compensating => "compensating",
            Self::Compensated => "compensated",
            Self::CompensationFailed => "compensation_failed",
        }
    }

    pub fn from_str_val(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "running" => Some(Self::Running),
            "paused" => Some(Self::Paused),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "compensating" => Some(Self::Compensating),
            "compensated" => Some(Self::Compensated),
            "compensation_failed" => Some(Self::CompensationFailed),
            _ => None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Completed
                | Self::Failed
                | Self::Cancelled
                | Self::Compensated
                | Self::CompensationFailed
        )
    }

    /// Check whether transitioning from `self` to `target` is valid.
    pub fn can_transition_to(&self, target: Self) -> bool {
        matches!(
            (self, target),
            (Self::Pending, Self::Running)
                | (Self::Running, Self::Completed)
                | (Self::Running, Self::Failed)
                | (Self::Running, Self::Cancelled)
                | (Self::Running, Self::Paused)
                | (Self::Running, Self::Compensating)
                | (Self::Paused, Self::Running)
                | (Self::Paused, Self::Cancelled)
                | (Self::Compensating, Self::Compensated)
                | (Self::Compensating, Self::CompensationFailed)
        )
    }
}

impl fmt::Display for WorkflowState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
