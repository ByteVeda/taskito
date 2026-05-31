import type { JobStatus } from "@/lib/api-types";

export type { JobStatus };

export type CircuitState = "closed" | "open" | "half_open";

export type ResourceHealth = "healthy" | "degraded" | "unhealthy" | "unknown";

export type Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

/** The CSS variable for a tone — for inline `style` use (bars, charts, dots). */
export const TONE_VAR: Record<Tone, string> = {
  neutral: "var(--fg-subtle)",
  accent: "var(--accent)",
  info: "var(--info)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

export const JOB_STATUS_TONE: Record<JobStatus, Tone> = {
  pending: "neutral",
  running: "info",
  complete: "success",
  failed: "danger",
  dead: "danger",
  cancelled: "warning",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: "Pending",
  running: "Running",
  complete: "Completed",
  failed: "Failed",
  dead: "Dead",
  cancelled: "Cancelled",
};

export const CIRCUIT_TONE: Record<CircuitState, Tone> = {
  closed: "success",
  half_open: "warning",
  open: "danger",
};

export const CIRCUIT_LABEL: Record<CircuitState, string> = {
  closed: "Closed",
  half_open: "Half open",
  open: "Open",
};

export function resourceTone(health: string): Tone {
  const key = health.toLowerCase();
  if (key === "healthy") return "success";
  if (key === "degraded") return "warning";
  if (key === "unhealthy") return "danger";
  return "neutral";
}

const LOG_LEVEL_CLASS: Record<string, string> = {
  error: "text-danger",
  warning: "text-warning",
  warn: "text-warning",
  info: "text-info",
  debug: "text-[var(--fg-subtle)]",
};

const LOG_LEVEL_FALLBACK = "text-[var(--fg-muted)]";

export function logLevelClass(level: string): string {
  return LOG_LEVEL_CLASS[level.toLowerCase()] ?? LOG_LEVEL_FALLBACK;
}
