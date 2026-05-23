import type {
  WorkflowDagResponse,
  WorkflowNode,
  WorkflowNodeStatus,
  WorkflowRun,
  WorkflowState,
} from "@/lib/api-types";

export type { WorkflowDagResponse, WorkflowNode, WorkflowNodeStatus, WorkflowRun, WorkflowState };

export interface WorkflowsListQuery {
  state?: WorkflowState;
  definition_name?: string;
  limit?: number;
  offset?: number;
}

export const TERMINAL_WORKFLOW_STATES = new Set<WorkflowState>([
  "completed",
  "completed_with_failures",
  "failed",
  "cancelled",
  "compensated",
  "compensation_failed",
]);

export const COMPENSATION_WORKFLOW_STATES = new Set<WorkflowState>([
  "completed_with_failures",
  "compensating",
  "compensated",
  "compensation_failed",
]);

export function isTerminalState(s: WorkflowState | undefined): boolean {
  return s !== undefined && TERMINAL_WORKFLOW_STATES.has(s);
}

export function shouldShowCompensationPanel(s: WorkflowState | undefined): boolean {
  return s !== undefined && COMPENSATION_WORKFLOW_STATES.has(s);
}
