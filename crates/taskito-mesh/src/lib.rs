pub mod config;
pub mod local_deque;
pub mod metrics;
pub mod ring;
pub mod state;
pub mod swim;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use taskito_core::job::Job;
use tokio::sync::Notify;

pub use config::MeshConfig;
pub use local_deque::LocalDeque;
pub use metrics::{MeshMetrics, MetricsSnapshot};
pub use state::{MemberState, MeshState, WorkerInfo};

/// A mesh node manages the local deque, consistent-hash ring, and (in later
/// phases) the SWIM gossip protocol and work-stealing connections.
///
/// Phase 1 provides local-deque prefetch with affinity sorting.
/// Gossip and stealing are added in subsequent phases.
pub struct MeshNode {
    config: MeshConfig,
    state: Arc<MeshState>,
    deque: LocalDeque,
    metrics: Arc<MeshMetrics>,
    shutdown: Arc<Notify>,
}

impl MeshNode {
    pub fn new(worker_id: String, config: MeshConfig) -> Self {
        let state = Arc::new(MeshState::new(worker_id, config.virtual_nodes));
        let deque = LocalDeque::new(config.local_buffer_capacity);
        Self {
            config,
            state,
            deque,
            metrics: Arc::new(MeshMetrics::default()),
            shutdown: Arc::new(Notify::new()),
        }
    }

    /// Spawn the SWIM gossip loop as a tokio task.
    /// Call this inside the tokio runtime before the scheduler loop.
    pub fn spawn_gossip(&self, queues: Vec<String>, threads: u16) -> tokio::task::JoinHandle<()> {
        let gossip_addr =
            SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), self.config.gossip_port);
        let steal_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), self.config.steal_port);
        let local_info = WorkerInfo {
            worker_id: self.state.local_worker_id().to_string(),
            gossip_addr,
            steal_addr,
            queues,
            threads,
            current_load: 0,
            local_buffer_len: 0,
            capacity: threads,
            updated_at: taskito_core::job::now_millis(),
        };

        let swim = swim::SwimNode::new(
            self.config.clone(),
            self.state.clone(),
            local_info,
            self.shutdown.clone(),
        );

        tokio::spawn(async move {
            swim.run().await;
        })
    }

    /// Signal the gossip loop to stop (broadcasts Leave first).
    pub fn request_shutdown(&self) {
        self.shutdown.notify_one();
    }

    pub fn config(&self) -> &MeshConfig {
        &self.config
    }

    pub fn state(&self) -> &Arc<MeshState> {
        &self.state
    }

    pub fn metrics(&self) -> MetricsSnapshot {
        self.metrics.snapshot()
    }

    // ── Local deque operations ──────────────────────────────────────────

    /// Pop a job from the local deque (front/hot end).
    /// Returns `None` if the deque is empty.
    pub fn pop_local(&self) -> Option<Job> {
        let job = self.deque.pop();
        if job.is_some() {
            self.metrics.local_pops.fetch_add(1, Ordering::Relaxed);
        }
        job
    }

    /// Push a batch of jobs into the local deque, sorted by affinity.
    /// Affinity-owned tasks go to the front (popped first), non-owned
    /// settle at the back (stealable).
    pub fn prefetch(&self, jobs: Vec<Job>) -> usize {
        if jobs.is_empty() {
            return 0;
        }
        self.metrics.prefetch_count.fetch_add(1, Ordering::Relaxed);
        let state = self.state.clone();
        let pushed = self
            .deque
            .push_sorted(jobs, |task_name| state.is_local_owner(task_name));
        self.metrics
            .prefetch_jobs
            .fetch_add(pushed as u64, Ordering::Relaxed);
        pushed
    }

    /// Whether the local deque has room for more prefetched jobs.
    pub fn should_prefetch(&self) -> bool {
        self.deque.len() < self.config.local_buffer_capacity / 2
    }

    /// Whether the local deque has jobs ready to dispatch.
    pub fn has_local_work(&self) -> bool {
        !self.deque.is_empty()
    }

    /// Current local deque length.
    pub fn local_len(&self) -> usize {
        self.deque.len()
    }

    // ── Affinity queries ────────────────────────────────────────────────

    /// Check if this worker is the affinity owner for a task name.
    pub fn is_affinity_owner(&self, task_name: &str) -> bool {
        self.state.is_local_owner(task_name)
    }

    // ── Steal operations (Phase 4 — stubs for now) ──────────────────────

    /// Steal up to `count` jobs from the cold end of the local deque.
    /// Used by the steal server to respond to steal requests.
    pub fn give_jobs(&self, count: usize) -> Vec<Job> {
        let stolen = self.deque.steal(count);
        self.metrics
            .jobs_stolen_out
            .fetch_add(stolen.len() as u64, Ordering::Relaxed);
        stolen
    }

    /// Whether this node should attempt to steal work from a peer.
    pub fn should_steal(&self) -> bool {
        self.config.enable_stealing && self.deque.len() <= self.config.steal_threshold
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use taskito_core::job::{now_millis, NewJob};

    fn make_job(task_name: &str) -> Job {
        NewJob {
            queue: "default".to_string(),
            task_name: task_name.to_string(),
            payload: vec![],
            priority: 0,
            scheduled_at: now_millis(),
            max_retries: 0,
            timeout_ms: 30_000,
            unique_key: None,
            metadata: None,
            notes: None,
            depends_on: vec![],
            expires_at: None,
            result_ttl_ms: None,
            namespace: None,
        }
        .into_job()
    }

    #[test]
    fn prefetch_and_pop() {
        let node = MeshNode::new("worker-1".to_string(), MeshConfig::default());
        let jobs = vec![make_job("task_a"), make_job("task_b"), make_job("task_c")];

        let pushed = node.prefetch(jobs);
        assert_eq!(pushed, 3);
        assert!(node.has_local_work());

        let metrics = node.metrics();
        assert_eq!(metrics.prefetch_count, 1);
        assert_eq!(metrics.prefetch_jobs, 3);

        let j1 = node.pop_local().unwrap();
        assert!(!j1.task_name.is_empty());

        let metrics = node.metrics();
        assert_eq!(metrics.local_pops, 1);
    }

    #[test]
    fn should_prefetch_tracks_capacity() {
        let config = MeshConfig {
            local_buffer_capacity: 4,
            ..MeshConfig::default()
        };
        let node = MeshNode::new("worker-1".to_string(), config);
        assert!(node.should_prefetch()); // empty = should prefetch

        node.prefetch(vec![make_job("a"), make_job("b"), make_job("c")]);
        assert!(!node.should_prefetch()); // 3/4 > capacity/2
    }

    #[test]
    fn should_steal_respects_config() {
        let config = MeshConfig {
            enable_stealing: false,
            ..MeshConfig::default()
        };
        let node = MeshNode::new("worker-1".to_string(), config);
        assert!(!node.should_steal());

        let config2 = MeshConfig {
            enable_stealing: true,
            steal_threshold: 2,
            ..MeshConfig::default()
        };
        let node2 = MeshNode::new("worker-2".to_string(), config2);
        assert!(node2.should_steal()); // empty deque ≤ threshold
    }
}
