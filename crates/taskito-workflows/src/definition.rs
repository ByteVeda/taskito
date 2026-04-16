use serde::{Deserialize, Serialize};

/// Metadata for a single step in a workflow definition.
///
/// Stored alongside the DAG structure to map node names to task queue details.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepMetadata {
    pub task_name: String,
    #[serde(default)]
    pub queue: Option<String>,
    #[serde(default)]
    pub args_template: Option<String>,
    #[serde(default)]
    pub kwargs_template: Option<String>,
    #[serde(default)]
    pub max_retries: Option<i32>,
    #[serde(default)]
    pub timeout_ms: Option<i64>,
    #[serde(default)]
    pub priority: Option<i32>,
    #[serde(default)]
    pub fan_out: Option<String>,
    #[serde(default)]
    pub fan_in: Option<String>,
    #[serde(default)]
    pub condition: Option<String>,
}

/// A persisted workflow definition: the DAG structure plus per-step metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub version: i32,
    /// The serialized dagron DAG (JSON via `SerializableGraph`).
    pub dag_data: Vec<u8>,
    /// Per-node metadata mapping node names to task configuration.
    pub step_metadata: std::collections::HashMap<String, StepMetadata>,
    pub created_at: i64,
}
