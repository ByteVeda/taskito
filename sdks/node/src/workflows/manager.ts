import { WorkflowError } from "../errors";
import type { NativeQueue } from "../native";
import type { Serializer } from "../serializers";
import { WorkflowAnalysis, type WorkflowGraph } from "./analysis";
import { WorkflowBuilder } from "./builder";
import { WorkflowCacheStore } from "./cache";
import { WorkflowTracker } from "./tracker";
import type {
  StepMetadataJson,
  SubWorkflowTransport,
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
 * sequenced by the core scheduler) plus the deferred step kinds the worker-side
 * tracker drives at runtime (see `tracker.ts`): fan-out / fan-in, conditions,
 * approval gates, sub-workflows, and saga compensation.
 */
export class WorkflowManager {
  constructor(
    private readonly native: NativeQueue,
    private readonly serializer: Serializer,
  ) {
    if (typeof this.native.submitWorkflow !== "function") {
      throw new WorkflowError("the native addon was built without the 'workflows' feature");
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

  /**
   * Structural + status analysis of a run (ancestors, descendants, topological
   * levels, critical path, stats). Returns `undefined` if the run is unknown or
   * its DAG can't be parsed.
   */
  analyze(runId: string): WorkflowAnalysis | undefined {
    const dagJson = this.dag(runId);
    if (dagJson === undefined) {
      return undefined;
    }
    let graph: WorkflowGraph;
    try {
      graph = JSON.parse(dagJson) as WorkflowGraph;
    } catch {
      return undefined;
    }
    if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges)) {
      return undefined;
    }
    return new WorkflowAnalysis(graph, this.nodes(runId));
  }

  /** Sub-workflow runs spawned by a run (empty for Node-submitted runs). */
  children(runId: string): WorkflowRun[] {
    return this.native.getWorkflowChildren(runId);
  }

  /** Drop every cached cacheable-step result. Returns the number removed. */
  clearCache(): number {
    return new WorkflowCacheStore(this.native).clear();
  }

  /**
   * Resolve a workflow gate that is `waiting_approval`, then advance (or skip)
   * its successors. Works from any process — the run plan is read from storage.
   * Idempotent: resolving an already-resolved gate is a no-op.
   */
  resolveGate(runId: string, nodeName: string, approved: boolean, error?: string): void {
    new WorkflowTracker(this.native, this.serializer).resolveGate(runId, nodeName, approved, error);
  }

  /** Approve a waiting gate (shorthand for `resolveGate(runId, node, true)`). */
  approveGate(runId: string, nodeName: string): void {
    this.resolveGate(runId, nodeName, true);
  }

  /** Reject a waiting gate (shorthand for `resolveGate(runId, node, false, error)`). */
  rejectGate(runId: string, nodeName: string, error?: string): void {
    this.resolveGate(runId, nodeName, false, error);
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
    const transport = this.toTransport(spec);
    const nodePayloads: Record<string, Buffer> = {};
    for (const [name, b64] of Object.entries(transport.nodePayloads)) {
      nodePayloads[name] = Buffer.from(b64, "base64");
    }
    const paramsJson = options?.params === undefined ? null : JSON.stringify(options.params);
    const runId = this.native.submitWorkflow(
      transport.name,
      transport.version,
      Buffer.from(transport.dag, "base64"),
      transport.stepMetadata,
      nodePayloads,
      options?.queueDefault ?? null,
      paramsJson,
      transport.deferredNodeNames,
      null,
      null,
    );
    return this.makeHandle(runId);
  }

  /**
   * Flatten a spec (and any nested sub-workflows) to its base64/JSON transport
   * form: serialize each node's args once, stamp deferred nodes' `args_template`
   * (the only storage-reconstructable channel for the tracker), and embed each
   * child workflow into its parent node's `sub_workflow` metadata.
   */
  private toTransport(spec: WorkflowSpec): SubWorkflowTransport {
    const dag = {
      nodes: spec.nodes.map((name) => ({ name })),
      edges: spec.edges.map((edge) => ({ from: edge.from, to: edge.to, weight: 1.0 })),
    };
    const deferred = new Set(spec.deferredNodeNames);
    const stepMetadata: Record<string, StepMetadataJson> = {};
    const nodePayloads: Record<string, string> = {};
    for (const name of spec.nodes) {
      const base = spec.stepMetadata[name];
      if (!base) {
        throw new WorkflowError(`workflow step '${name}' is missing metadata`);
      }
      const b64 = Buffer.from(this.serializer.serialize(spec.stepArgs[name] ?? [])).toString(
        "base64",
      );
      nodePayloads[name] = b64;
      const meta: StepMetadataJson = { ...base };
      if (deferred.has(name)) {
        meta.args_template = b64;
      }
      const child = spec.subWorkflows?.[name];
      if (child) {
        meta.sub_workflow = JSON.stringify(this.toTransport(child));
      }
      stepMetadata[name] = meta;
    }
    return {
      name: spec.name,
      version: spec.version,
      dag: Buffer.from(JSON.stringify(dag)).toString("base64"),
      stepMetadata: JSON.stringify(stepMetadata),
      nodePayloads,
      deferredNodeNames: spec.deferredNodeNames,
    };
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
        throw new WorkflowError(`workflow run '${runId}' not found`);
      }
      if (TERMINAL_STATES.has(run.state)) {
        return run;
      }
      if (Date.now() >= deadline) {
        throw new WorkflowError(`workflow run '${runId}' did not finish within ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
