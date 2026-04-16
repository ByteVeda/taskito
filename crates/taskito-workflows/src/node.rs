use std::fmt;

use serde::{Deserialize, Serialize};

/// Status of a single node within a workflow run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowNodeStatus {
    Pending,
    Ready,
    Running,
    Completed,
    Failed,
    Skipped,
    WaitingApproval,
    CacheHit,
}

impl WorkflowNodeStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Ready => "ready",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Skipped => "skipped",
            Self::WaitingApproval => "waiting_approval",
            Self::CacheHit => "cache_hit",
        }
    }

    pub fn from_str_val(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "ready" => Some(Self::Ready),
            "running" => Some(Self::Running),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "skipped" => Some(Self::Skipped),
            "waiting_approval" => Some(Self::WaitingApproval),
            "cache_hit" => Some(Self::CacheHit),
            _ => None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Skipped | Self::CacheHit
        )
    }
}

impl fmt::Display for WorkflowNodeStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A single node instance within a workflow run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowNode {
    pub id: String,
    pub run_id: String,
    pub node_name: String,
    pub job_id: Option<String>,
    pub status: WorkflowNodeStatus,
    pub result_hash: Option<String>,
    pub fan_out_count: Option<i32>,
    pub fan_in_data: Option<String>,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub error: Option<String>,
}
