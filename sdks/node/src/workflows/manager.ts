import type { NativeQueue } from "../native";
import type { Serializer } from "../serializers";
import { WorkflowBuilder } from "./builder";
import type {
  WorkflowHandle,
  WorkflowNode,
  WorkflowRun,
  WorkflowSpec,
  WorkflowSubmitOptions,
  WorkflowWaitOptions,
} from "./types";

/** Run states with no further transitions. */
const TERMINAL_STATES = new Set([
  "completed",
  "completed_with_failures",
  "failed",
  "cancelled",
  "compensated",
  "compensation_failed",
]);

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_POLL_MS = 100;

/**
 * The `queue.workflows` facade: define and submit workflows, then query runs.
 *
 * Supports DAG / linear workflows (steps pre-enqueued with `depends_on` chains,
 * sequenced by the core scheduler) plus fan-out / fan-in steps the worker-side
 * tracker expands at runtime (see `tracker.ts`). Gates, sub-workflows, and saga
 * compensation are not yet available in the Node SDK.
 */
export class WorkflowManager {
  constructor(
    private readonly native: NativeQueue,
    private readonly serializer: Serializer,
  ) {
    if (typeof this.native.submitWorkflow !== "function") {
      throw new Error("the native addon was built without the 'workflows' feature");
    }
  }

  /** Start defining a workflow. Chain `.step(...)` then `.submit()`. */
  define(name: string, version = 1): WorkflowBuilder {
    return new WorkflowBuilder(name, version, (spec) => this.submitSpec(spec));
  }

  /** Submit a pre-built builder (alternative to `builder.submit()`). */
  submit(builder: WorkflowBuilder, options?: WorkflowSubmitOptions): WorkflowHandle {
    return this.submitSpec(builder.build(), options);
  }

  /** Fetch a run by id, or `undefined` if it doesn't exist. */
  run(runId: string): WorkflowRun | undefined {
    return this.native.getWorkflowRun(runId) ?? undefined;
  }

  /** The step nodes of a run. */
  nodes(runId: string): WorkflowNode[] {
    return this.native.getWorkflowNodes(runId);
  }

  /** The serialized DAG (graph JSON) for a run, or `undefined` if unknown. */
  dag(runId: string): string | undefined {
    return this.native.getWorkflowDag(runId) ?? undefined;
  }

  /** Sub-workflow runs spawned by a run (empty for Node-submitted runs). */
  children(runId: string): WorkflowRun[] {
    return this.native.getWorkflowChildren(runId);
  }

  /** List runs, optionally filtered by definition name and/or state. */
  list(options?: {
    definitionName?: string;
    state?: string;
    limit?: number;
    offset?: number;
  }): WorkflowRun[] {
    return this.native.listWorkflowRuns(
      options?.definitionName ?? null,
      options?.state ?? null,
      options?.limit ?? null,
      options?.offset ?? null,
    );
  }

  private submitSpec(spec: WorkflowSpec, options?: WorkflowSubmitOptions): WorkflowHandle {
    const dag = {
      nodes: spec.nodes.map((name) => ({ name })),
      edges: spec.edges.map((edge) => ({ from: edge.from, to: edge.to, weight: 1.0 })),
    };
    const dagBytes = Buffer.from(JSON.stringify(dag));

    // Static nodes are enqueued by `submitWorkflow` from these payloads. For
    // deferred nodes the tracker enqueues later, so we persist their args in
    // `args_template` (base64) — the only storage-reconstructable channel.
    const deferred = new Set(spec.deferredNodeNames);
    const stepMetadata = { ...spec.stepMetadata };
    const nodePayloads: Record<string, Buffer> = {};
    for (const name of spec.nodes) {
      const payload = Buffer.from(this.serializer.serialize(spec.stepArgs[name] ?? []));
      nodePayloads[name] = payload;
      const meta = stepMetadata[name];
      if (deferred.has(name) && meta) {
        stepMetadata[name] = { ...meta, args_template: payload.toString("base64") };
      }
    }

    const paramsJson = options?.params === undefined ? null : JSON.stringify(options.params);
    const runId = this.native.submitWorkflow(
      spec.name,
      spec.version,
      dagBytes,
      JSON.stringify(stepMetadata),
      nodePayloads,
      options?.queueDefault ?? null,
      paramsJson,
      spec.deferredNodeNames,
    );
    return this.makeHandle(runId);
  }

  private makeHandle(runId: string): WorkflowHandle {
    return {
      runId,
      status: () => this.run(runId),
      nodes: () => this.nodes(runId),
      wait: (waitOptions) => this.waitForRun(runId, waitOptions),
    };
  }

  private async waitForRun(runId: string, options?: WorkflowWaitOptions): Promise<WorkflowRun> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const pollMs = options?.pollMs ?? DEFAULT_WAIT_POLL_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`workflow wait timeoutMs must be a positive number, got ${timeoutMs}`);
    }
    if (!Number.isFinite(pollMs) || pollMs <= 0) {
      throw new Error(`workflow wait pollMs must be a positive number, got ${pollMs}`);
    }
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const run = this.native.getWorkflowRun(runId);
      if (!run) {
        throw new Error(`workflow run '${runId}' not found`);
      }
      if (TERMINAL_STATES.has(run.state)) {
        return run;
      }
      if (Date.now() >= deadline) {
        throw new Error(`workflow run '${runId}' did not finish within ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
