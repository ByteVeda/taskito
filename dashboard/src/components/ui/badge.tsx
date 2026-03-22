import type { JobStatus } from "../../api";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/20",
  running: "bg-info/10 text-info border-info/20",
  complete: "bg-success/10 text-success border-success/20",
  failed: "bg-danger/10 text-danger border-danger/20",
  dead: "bg-danger/15 text-danger border-danger/25",
  cancelled: "bg-muted/10 text-muted border-muted/20",
  closed: "bg-success/10 text-success border-success/20",
  open: "bg-danger/10 text-danger border-danger/20",
  half_open: "bg-warning/10 text-warning border-warning/20",
  healthy: "bg-success/10 text-success border-success/20",
  unhealthy: "bg-danger/10 text-danger border-danger/20",
  degraded: "bg-warning/10 text-warning border-warning/20",
  active: "bg-success/10 text-success border-success/20",
  paused: "bg-warning/10 text-warning border-warning/20",
};

const DOT_COLORS: Record<string, string> = {
  pending: "bg-warning",
  running: "bg-info",
  complete: "bg-success",
  failed: "bg-danger",
  dead: "bg-danger",
  cancelled: "bg-muted",
  closed: "bg-success",
  open: "bg-danger",
  half_open: "bg-warning",
  healthy: "bg-success",
  unhealthy: "bg-danger",
  degraded: "bg-warning",
  active: "bg-success",
  paused: "bg-warning",
};

interface BadgeProps {
  status: JobStatus | string;
}

export function Badge({ status }: BadgeProps) {
  const style = STATUS_STYLES[status] ?? "bg-muted/10 text-muted border-muted/20";
  const dot = DOT_COLORS[status] ?? "bg-muted";
  return (
    <span
      class={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide border ${style}`}
    >
      <span class={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  );
}
