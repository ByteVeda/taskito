export const ROUTES = {
  OVERVIEW: "/",
  JOBS: "/jobs",
  JOB_DETAIL: "/jobs/:id",
  METRICS: "/metrics",
  LOGS: "/logs",
  WORKERS: "/workers",
  CIRCUIT_BREAKERS: "/circuit-breakers",
  DEAD_LETTERS: "/dead-letters",
  RESOURCES: "/resources",
  QUEUES: "/queues",
  SYSTEM: "/system",
} as const;

/** Props injected by preact-router on routed components. */
export interface RoutableProps {
  path?: string;
}
