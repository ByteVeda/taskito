import type { JsWorkflowAdvance, JsWorkflowNode, JsWorkflowRun } from "../native";

/** A workflow run row (state, timestamps, lineage). */
export type WorkflowRun = JsWorkflowRun;
/** One step of a run, linked to its underlying job. */
export type WorkflowNode = JsWorkflowNode;
/** Result of advancing a node — `finalState` set once the run is terminal. */
export type WorkflowAdvance = JsWorkflowAdvance;

/** Lowercase workflow run states (mirrors the Rust `WorkflowState`). */
export type WorkflowRunState =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "completed_with_failures"
  | "failed"
  | "cancelled"
  | "compensating"
  | "compensated"
  | "compensation_failed";

/** Per-step options when building a workflow. */
export interface WorkflowStepOptions {
  /** Predecessor step name(s) this step runs after. */
  after?: string | string[];
  /** Positional args passed to the step's task handler. */
  args?: unknown[];
  /** Queue to run this step on (defaults to the submit-time `queueDefault`). */
  queue?: string;
  maxRetries?: number;
  timeoutMs?: number;
  priority?: number;
}

/** snake_case step metadata, matching the Rust `StepMetadata` shape. */
export interface StepMetadataJson {
  task_name: string;
  queue?: string;
  max_retries?: number;
  timeout_ms?: number;
  priority?: number;
}

/** A built workflow definition, ready to submit. */
export interface WorkflowSpec {
  name: string;
  version: number;
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
  stepMetadata: Record<string, StepMetadataJson>;
  stepArgs: Record<string, unknown[]>;
}

/** Submit-time options. */
export interface WorkflowSubmitOptions {
  /** Default queue for steps that don't set their own. */
  queueDefault?: string;
  /** Arbitrary params recorded on the run (JSON-encoded). */
  params?: unknown;
}

/** Options for {@link WorkflowHandle.wait}. */
export interface WorkflowWaitOptions {
  /** Max time to wait for a terminal state (ms). Default 30000. */
  timeoutMs?: number;
  /** Poll interval (ms). Default 100. */
  pollMs?: number;
}

/** Handle to a submitted run: query status/nodes or await completion. */
export interface WorkflowHandle {
  readonly runId: string;
  /** Current run row, or `undefined` if it has been purged. */
  status(): WorkflowRun | undefined;
  /** The run's step nodes. */
  nodes(): WorkflowNode[];
  /** Resolve once the run reaches a terminal state (or reject on timeout). */
  wait(options?: WorkflowWaitOptions): Promise<WorkflowRun>;
}
