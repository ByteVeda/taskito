import { Badge } from "@/components/ui/badge";
import type { WorkflowNodeStatus, WorkflowState } from "../types";

type Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

const STATE_TONE: Record<WorkflowState, Tone> = {
  pending: "neutral",
  running: "info",
  paused: "warning",
  completed: "success",
  completed_with_failures: "warning",
  failed: "danger",
  cancelled: "neutral",
  compensating: "warning",
  compensated: "info",
  compensation_failed: "danger",
};

const STATE_LABEL: Record<WorkflowState, string> = {
  pending: "Pending",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  completed_with_failures: "Completed (partial)",
  failed: "Failed",
  cancelled: "Cancelled",
  compensating: "Compensating",
  compensated: "Compensated",
  compensation_failed: "Compensation failed",
};

export function WorkflowStateBadge({ state }: { state: WorkflowState }) {
  return <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>;
}

const NODE_STATUS_TONE: Record<WorkflowNodeStatus, Tone> = {
  pending: "neutral",
  ready: "info",
  running: "info",
  completed: "success",
  failed: "danger",
  skipped: "neutral",
  waiting_approval: "warning",
  cache_hit: "accent",
  compensating: "warning",
  compensated: "info",
  compensation_failed: "danger",
};

export function WorkflowNodeStatusBadge({ status }: { status: WorkflowNodeStatus }) {
  return <Badge tone={NODE_STATUS_TONE[status]}>{status.replace(/_/g, " ")}</Badge>;
}
