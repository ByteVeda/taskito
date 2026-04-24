export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "dead"
  | "cancelled"
  | "scheduled";

export type CircuitState = "closed" | "open" | "half_open";

export type ResourceHealth = "healthy" | "degraded" | "unhealthy" | "unknown";

type ToneKey = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

const TONE_CLASS: Record<ToneKey, string> = {
  neutral:
    "bg-[var(--surface-3)] text-[var(--fg-muted)] ring-1 ring-inset ring-[var(--border-strong)]",
  accent: "bg-accent-dim text-accent ring-1 ring-inset ring-accent/30",
  info: "bg-info-dim text-info ring-1 ring-inset ring-info/30",
  success: "bg-success-dim text-success ring-1 ring-inset ring-success/30",
  warning: "bg-warning-dim text-warning ring-1 ring-inset ring-warning/30",
  danger: "bg-danger-dim text-danger ring-1 ring-inset ring-danger/30",
};

export const JOB_STATUS_TONE: Record<JobStatus, ToneKey> = {
  pending: "neutral",
  running: "info",
  scheduled: "accent",
  completed: "success",
  failed: "danger",
  dead: "danger",
  cancelled: "warning",
};

export const CIRCUIT_TONE: Record<CircuitState, ToneKey> = {
  closed: "success",
  half_open: "warning",
  open: "danger",
};

export const RESOURCE_TONE: Record<ResourceHealth, ToneKey> = {
  healthy: "success",
  degraded: "warning",
  unhealthy: "danger",
  unknown: "neutral",
};

export function toneClasses(tone: ToneKey): string {
  return TONE_CLASS[tone];
}
