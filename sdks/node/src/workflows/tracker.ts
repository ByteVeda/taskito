import type { JsOutcome, NativeQueue } from "../native";
import type { Serializer } from "../serializers";
import { createLogger } from "../utils";
import { predecessorsOf, successorsOf, transitiveDeferred } from "./plan";

const log = createLogger("workflow-tracker");

const DEFAULT_QUEUE = "default";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 300_000;

/** Node statuses with no further transitions (mirrors `WorkflowNodeStatus::is_terminal`). */
const TERMINAL_NODE_STATUS = new Set([
  "completed",
  "failed",
  "skipped",
  "cache_hit",
  "compensated",
  "compensation_failed",
]);

/** A fan-out child node name (`parent[3]`) → its parent (`parent`), else null. */
const FAN_OUT_CHILD = /^(.+)\[\d+\]$/;

/** snake_case step metadata as stored in the workflow definition. */
interface StepMeta {
  task_name: string;
  queue?: string;
  max_retries?: number;
  timeout_ms?: number;
  priority?: number;
  args_template?: string;
  fan_out?: string;
  fan_in?: string;
}

/** The reconstructed structure + config of a workflow run. */
interface RunPlan {
  successors: Map<string, string[]>;
  predecessors: Map<string, string[]>;
  deferred: Set<string>;
  meta: Map<string, StepMeta>;
}

/**
 * The runtime workflow brain. Driven from the worker's outcome callback, it
 * advances a run as each node-job settles. For plain DAGs the core scheduler
 * already sequences nodes via `depends_on`, so the tracker only records status.
 * For runs with deferred (fan-out / fan-in) nodes it owns the on-demand
 * orchestration: expand fan-outs, collect fan-ins, enqueue downstream nodes,
 * cascade fail-fast, and finalize the run.
 *
 * The run plan is reconstructed from storage (DAG + step metadata), so the
 * tracker works regardless of which process submitted the run.
 *
 * Runs entirely synchronously inside the (sequential) outcome callback: job
 * results are committed before the callback fires, so reads never race.
 */
export class WorkflowTracker {
  private readonly plans = new Map<string, RunPlan>();

  constructor(
    private readonly native: NativeQueue,
    private readonly serializer: Serializer,
  ) {}

  /** Handle one worker outcome. A no-op for non-workflow jobs. */
  onOutcome(outcome: JsOutcome): void {
    let succeeded: boolean;
    if (outcome.kind === "success") {
      succeeded = true;
    } else if (outcome.kind === "dead") {
      succeeded = false;
    } else {
      return; // retry / cancelled are not terminal for workflow advancement
    }

    try {
      const ref = this.native.workflowNodeForJob(outcome.jobId);
      if (!ref) {
        return; // not a workflow job
      }
      this.advance(outcome.jobId, ref.runId, ref.nodeName, succeeded, outcome.error ?? null);
    } catch (error) {
      // Workflow bookkeeping must never break the worker loop.
      log.debug(() => `workflow advance for ${outcome.jobId} failed`, error);
    }
  }

  private advance(
    jobId: string,
    runId: string,
    nodeName: string,
    succeeded: boolean,
    error: string | null,
  ): void {
    const plan = this.plan(runId);
    if (!plan) {
      return;
    }
    const managed = plan.deferred.size > 0;

    // Record the node's outcome. For plain DAGs the core also cascades + finalizes.
    const advance = this.native.markWorkflowNodeResult(jobId, succeeded, error, managed);
    if (!managed) {
      this.evictIfTerminal(runId, advance?.finalState ?? null);
      return;
    }

    const parent = fanOutParentOf(nodeName);
    if (parent !== null && isFanOut(plan, parent)) {
      this.onFanOutChild(runId, parent, plan);
    } else if (succeeded) {
      this.evaluateSuccessors(runId, nodeName, plan);
    } else {
      this.native.cascadeSkipPending(runId); // fail-fast
    }

    this.evictIfTerminal(runId, this.native.finalizeRunIfTerminal(runId));
  }

  /** Drop a finished run's cached plan so the cache doesn't grow unbounded. */
  private evictIfTerminal(runId: string, finalState: string | null): void {
    if (finalState !== null) {
      this.plans.delete(runId);
    }
  }

  /** A fan-out child settled — finalize the parent once all children are terminal. */
  private onFanOutChild(runId: string, parent: string, plan: RunPlan): void {
    const completion = this.native.checkFanOutCompletion(runId, parent);
    if (!completion) {
      return; // children still in flight, or another caller already finalized
    }
    if (completion.succeeded) {
      this.onFanOutParentDone(runId, parent, completion.childJobIds, plan);
    } else {
      this.native.cascadeSkipPending(runId); // a child failed → fail-fast
    }
  }

  /** A fan-out parent completed successfully — collect into fan-in or move on. */
  private onFanOutParentDone(
    runId: string,
    parent: string,
    childJobIds: string[],
    plan: RunPlan,
  ): void {
    const fanInNode = this.fanInNodeFor(parent, plan);
    if (fanInNode) {
      this.createFanInJob(runId, fanInNode, childJobIds, plan);
    } else {
      this.evaluateSuccessors(runId, parent, plan);
    }
  }

  /** Read `itemsFrom`'s array result and expand the fan-out into one child per item. */
  private expandFanOut(runId: string, node: string, plan: RunPlan): void {
    const meta = plan.meta.get(node);
    if (!meta?.fan_out) {
      return;
    }
    const itemsFrom =
      (JSON.parse(meta.fan_out).itemsFrom as string | null) ?? singlePred(plan, node);
    const items = this.readArrayResult(runId, itemsFrom);
    const childNames = items.map((_, i) => `${node}[${i}]`);
    const childPayloads = items.map((item) => Buffer.from(this.serializer.serialize([item])));

    this.native.expandFanOut(
      runId,
      node,
      childNames,
      childPayloads,
      meta.task_name,
      meta.queue ?? DEFAULT_QUEUE,
      meta.max_retries ?? DEFAULT_MAX_RETRIES,
      meta.timeout_ms ?? DEFAULT_TIMEOUT_MS,
      meta.priority ?? 0,
    );

    // Empty fan-out completes the parent immediately, so no child outcome will
    // fire to carry the run forward — do it inline.
    if (items.length === 0) {
      this.onFanOutParentDone(runId, node, [], plan);
    }
  }

  /** Collect the children's results and enqueue the combiner job. */
  private createFanInJob(
    runId: string,
    fanInNode: string,
    childJobIds: string[],
    plan: RunPlan,
  ): void {
    const results = childJobIds.map((id) => {
      const job = this.native.getJob(id);
      if (!job?.result) {
        throw new Error(`fan-in: child job '${id}' has no result`);
      }
      return this.serializer.deserialize(job.result);
    });
    const meta = plan.meta.get(fanInNode);
    if (!meta) {
      return;
    }
    // The combiner receives the whole list as its single positional argument.
    const payload = Buffer.from(this.serializer.serialize([results]));
    this.native.createDeferredJob(
      runId,
      fanInNode,
      payload,
      meta.task_name,
      meta.queue ?? DEFAULT_QUEUE,
      meta.max_retries ?? DEFAULT_MAX_RETRIES,
      meta.timeout_ms ?? DEFAULT_TIMEOUT_MS,
      meta.priority ?? 0,
    );
  }

  /** Enqueue/expand any deferred successor whose predecessors are now all terminal. */
  private evaluateSuccessors(runId: string, nodeName: string, plan: RunPlan): void {
    for (const succ of plan.successors.get(nodeName) ?? []) {
      if (!plan.deferred.has(succ) || !this.allPredecessorsTerminal(runId, succ, plan)) {
        continue;
      }
      const meta = plan.meta.get(succ);
      if (meta?.fan_in) {
        continue; // fan-in jobs are created from the fan-out completion path
      }
      if (meta?.fan_out) {
        this.expandFanOut(runId, succ, plan);
      } else {
        this.createDeferredJob(runId, succ, plan);
      }
    }
  }

  /** Enqueue a plain deferred node using its persisted args. */
  private createDeferredJob(runId: string, node: string, plan: RunPlan): void {
    const meta = plan.meta.get(node);
    if (!meta) {
      return;
    }
    const payload = meta.args_template
      ? Buffer.from(meta.args_template, "base64")
      : Buffer.from(this.serializer.serialize([]));
    this.native.createDeferredJob(
      runId,
      node,
      payload,
      meta.task_name,
      meta.queue ?? DEFAULT_QUEUE,
      meta.max_retries ?? DEFAULT_MAX_RETRIES,
      meta.timeout_ms ?? DEFAULT_TIMEOUT_MS,
      meta.priority ?? 0,
    );
  }

  private allPredecessorsTerminal(runId: string, node: string, plan: RunPlan): boolean {
    const preds = plan.predecessors.get(node) ?? [];
    if (preds.length === 0) {
      return true;
    }
    const status = this.nodeStatuses(runId);
    return preds.every((p) => TERMINAL_NODE_STATUS.has(status.get(p) ?? ""));
  }

  /** The combiner-input node that collects a given fan-out, if any. */
  private fanInNodeFor(parent: string, plan: RunPlan): string | null {
    for (const succ of plan.successors.get(parent) ?? []) {
      const meta = plan.meta.get(succ);
      if (meta?.fan_in) {
        const from = JSON.parse(meta.fan_in).from as string | undefined;
        if (!from || from === parent) {
          return succ;
        }
      }
    }
    return null;
  }

  /** Deserialize the array result of a node's job (its sole positional arg shape). */
  private readArrayResult(runId: string, nodeName: string): unknown[] {
    const node = this.native.getWorkflowNodes(runId).find((n) => n.nodeName === nodeName);
    if (!node?.jobId) {
      throw new Error(`fan-out source '${nodeName}' has no job`);
    }
    const job = this.native.getJob(node.jobId);
    if (!job?.result) {
      throw new Error(`fan-out source '${nodeName}' has no result`);
    }
    const value = this.serializer.deserialize(job.result);
    if (!Array.isArray(value)) {
      throw new Error(`fan-out source '${nodeName}' must return an array`);
    }
    return value;
  }

  private nodeStatuses(runId: string): Map<string, string> {
    return new Map(this.native.getWorkflowNodes(runId).map((n) => [n.nodeName, n.status]));
  }

  /** Load + cache the run plan from storage. Returns null if the run is gone. */
  private plan(runId: string): RunPlan | null {
    const cached = this.plans.get(runId);
    if (cached) {
      return cached;
    }
    const raw = this.native.getWorkflowRunPlan(runId);
    if (!raw) {
      return null;
    }
    const graph = JSON.parse(raw.dag) as { edges?: Array<{ from: string; to: string }> };
    const edges = graph.edges ?? [];
    const meta = new Map<string, StepMeta>(
      Object.entries(JSON.parse(raw.stepMetadata) as Record<string, StepMeta>),
    );
    const successors = successorsOf(edges);
    const seeds = [...meta].filter(([, m]) => m.fan_out || m.fan_in).map(([name]) => name);
    const plan: RunPlan = {
      successors,
      predecessors: predecessorsOf(edges),
      deferred: transitiveDeferred(seeds, successors),
      meta,
    };
    this.plans.set(runId, plan);
    return plan;
  }
}

/** `parent[3]` → `parent`; a non-child name → null. */
function fanOutParentOf(nodeName: string): string | null {
  return FAN_OUT_CHILD.exec(nodeName)?.[1] ?? null;
}

function isFanOut(plan: RunPlan, node: string): boolean {
  return Boolean(plan.meta.get(node)?.fan_out);
}

function singlePred(plan: RunPlan, node: string): string {
  const preds = plan.predecessors.get(node) ?? [];
  const [only] = preds;
  if (preds.length !== 1 || only === undefined) {
    throw new Error(
      `fan-out '${node}' needs exactly one predecessor or an explicit itemsFrom (has ${preds.length})`,
    );
  }
  return only;
}
