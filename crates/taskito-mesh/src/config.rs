use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshConfig {
    /// UDP port for SWIM gossip protocol.
    pub gossip_port: u16,
    /// TCP port for work-stealing connections (default: gossip_port + 1).
    pub steal_port: u16,
    /// Bind address for gossip and steal listeners.
    pub bind_addr: String,
    /// Seed nodes for initial cluster join (e.g., `["host1:7946"]`).
    pub seeds: Vec<String>,
    /// SWIM protocol period in milliseconds.
    pub protocol_period_ms: u64,
    /// Indirect ping targets for failure detection.
    pub indirect_ping_count: usize,
    /// Suspicion timeout multiplier (applied to `log(N+1) * protocol_period`).
    pub suspicion_multiplier: u32,
    /// Virtual nodes per worker on the consistent hash ring.
    pub virtual_nodes: usize,
    /// Max jobs in the local deque before refusing to prefetch.
    pub local_buffer_capacity: usize,
    /// Max jobs to steal per request.
    pub max_steal_batch: usize,
    /// Steal when own deque length is at or below this threshold.
    pub steal_threshold: usize,
    /// Affinity weight: 0.0 = ignore affinity, 1.0 = strict affinity.
    pub affinity_weight: f64,
    /// Whether work-stealing is enabled.
    pub enable_stealing: bool,
}

impl Default for MeshConfig {
    fn default() -> Self {
        Self {
            gossip_port: 7946,
            steal_port: 7947,
            bind_addr: "0.0.0.0".to_string(),
            seeds: Vec::new(),
            protocol_period_ms: 500,
            indirect_ping_count: 3,
            suspicion_multiplier: 4,
            virtual_nodes: 150,
            local_buffer_capacity: 64,
            max_steal_batch: 4,
            steal_threshold: 2,
            affinity_weight: 0.7,
            enable_stealing: true,
        }
    }
}
