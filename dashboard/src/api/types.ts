export type JobStatus = "pending" | "running" | "complete" | "failed" | "dead" | "cancelled";

export interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  dead: number;
  cancelled: number;
}

export interface Job {
  id: string;
  task_name: string;
  queue: string;
  status: JobStatus;
  priority: number;
  progress: number | null;
  retry_count: number;
  max_retries: number;
  created_at: number;
  scheduled_at: number;
  started_at: number | null;
  completed_at: number | null;
  timeout_ms: number;
  error: string | null;
  unique_key: string | null;
  metadata: string | null;
}

export interface JobError {
  attempt: number;
  error: string;
  failed_at: number;
}

export interface TaskLog {
  job_id: string;
  task_name: string;
  level: string;
  message: string;
  extra: string | null;
  logged_at: number;
}

export interface ReplayEntry {
  replay_job_id: string;
  replayed_at: number;
  original_error: string | null;
  replay_error: string | null;
}

export interface DagData {
  nodes: DagNode[];
  edges: DagEdge[];
}

export interface DagNode {
  id: string;
  task_name: string;
  status: JobStatus;
}

export interface DagEdge {
  from: string;
  to: string;
}

export interface DeadLetter {
  id: string;
  original_job_id: string;
  task_name: string;
  queue: string;
  error: string | null;
  retry_count: number;
  failed_at: number;
}

export type MetricsResponse = Record<string, TaskMetrics>;

export interface TaskMetrics {
  count: number;
  success_count: number;
  failure_count: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  min_ms: number;
  max_ms: number;
}

export interface TimeseriesBucket {
  timestamp: number;
  count: number;
  success: number;
  failure: number;
  avg_ms: number;
}

export interface Worker {
  worker_id: string;
  queues: string;
  last_heartbeat: number;
  registered_at: number;
  tags: string | null;
}

export interface CircuitBreaker {
  task_name: string;
  state: "closed" | "open" | "half_open";
  failure_count: number;
  threshold: number;
  window_ms: number;
  cooldown_ms: number;
  last_failure_at: number | null;
}

export interface ResourceStatus {
  name: string;
  scope: string;
  health: string;
  init_duration_ms: number;
  recreations: number;
  depends_on: string[];
  pool?: {
    active: number;
    idle: number;
    size: number;
    total_timeouts: number;
  };
}

export type ProxyStats = Record<
  string,
  {
    reconstructions: number;
    avg_ms: number;
    errors: number;
  }
>;

export type InterceptionStats = Record<
  string,
  {
    count: number;
    avg_ms: number;
  }
>;

export type QueueStatsMap = Record<
  string,
  {
    pending: number;
    running: number;
    completed?: number;
    failed?: number;
    dead?: number;
    cancelled?: number;
  }
>;
