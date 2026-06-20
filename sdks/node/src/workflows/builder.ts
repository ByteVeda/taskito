import { successorsOf, transitiveDeferred } from "./plan";
import type {
  FanInStepOptions,
  FanOutStepOptions,
  StepMetadataJson,
  WorkflowHandle,
  WorkflowSpec,
  WorkflowStepOptions,
} from "./types";

/**
 * Fluent builder for a workflow DAG. Each {@link WorkflowBuilder.step} adds a
 * node; `after` declares edges. Steps may reference predecessors that are added
 * later — the DAG is validated (and topologically ordered) at submit time.
 *
 * {@link WorkflowBuilder.fanOut} / {@link WorkflowBuilder.fanIn} add dynamic
 * steps the tracker expands at runtime (see `tracker.ts`).
 *
 * Obtain one via `queue.workflows.define(name)`; finish with `.submit()`.
 */
export class WorkflowBuilder {
  private readonly nodes: string[] = [];
  private readonly edges: Array<{ from: string; to: string }> = [];
  private readonly stepMetadata: Record<string, StepMetadataJson> = {};
  private readonly stepArgs: Record<string, unknown[]> = {};
  private readonly seen = new Set<string>();
  /** Nodes that run no static job — expanded/enqueued by the tracker. */
  private readonly deferredSeeds = new Set<string>();

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly submitFn: (spec: WorkflowSpec) => WorkflowHandle,
  ) {}

  /** Add a step `name` that runs the registered task `taskName`. */
  step(name: string, taskName: string, options: WorkflowStepOptions = {}): this {
    this.addNode(name, options.after);
    this.stepMetadata[name] = {
      task_name: taskName,
      queue: options.queue,
      max_retries: options.maxRetries,
      timeout_ms: options.timeoutMs,
      priority: options.priority,
    };
    this.stepArgs[name] = options.args ?? [];
    return this;
  }

  /**
   * Add a fan-out step. At runtime the tracker reads the array result of
   * `itemsFrom` and expands one child per item, each running `options.task`.
   */
  fanOut(name: string, options: FanOutStepOptions): this {
    this.addNode(name, options.after);
    this.stepMetadata[name] = {
      task_name: options.task,
      queue: options.queue,
      max_retries: options.maxRetries,
      timeout_ms: options.timeoutMs,
      priority: options.priority,
      fan_out: JSON.stringify({ itemsFrom: options.itemsFrom ?? null }),
    };
    this.stepArgs[name] = [];
    this.deferredSeeds.add(name);
    return this;
  }

  /**
   * Add a fan-in step that collects the children of fan-out `options.after`
   * and runs `options.task` with `[childResult, …]` as its single argument.
   */
  fanIn(name: string, options: FanInStepOptions): this {
    this.addNode(name, options.after);
    this.stepMetadata[name] = {
      task_name: options.task,
      queue: options.queue,
      max_retries: options.maxRetries,
      timeout_ms: options.timeoutMs,
      priority: options.priority,
      fan_in: JSON.stringify({ from: options.after }),
    };
    this.stepArgs[name] = [];
    this.deferredSeeds.add(name);
    return this;
  }

  /** Materialize the validated spec without submitting. */
  build(): WorkflowSpec {
    for (const edge of this.edges) {
      if (!this.seen.has(edge.from)) {
        throw new Error(`step '${edge.to}' depends on unknown step '${edge.from}'`);
      }
    }
    // A fan-in node is only ever enqueued by its fan-out's completion, so its
    // `after` must point at a fan-out step — otherwise the run would hang.
    for (const [name, meta] of Object.entries(this.stepMetadata)) {
      if (!meta.fan_in) {
        continue;
      }
      const { from } = JSON.parse(meta.fan_in) as { from: string };
      if (!this.stepMetadata[from]?.fan_out) {
        throw new Error(
          `fan-in step '${name}' must target a fan-out step, but '${from}' is not one`,
        );
      }
    }
    const deferred = transitiveDeferred(this.deferredSeeds, successorsOf(this.edges));
    return {
      name: this.name,
      version: this.version,
      nodes: [...this.nodes],
      edges: [...this.edges],
      stepMetadata: { ...this.stepMetadata },
      stepArgs: { ...this.stepArgs },
      deferredNodeNames: [...deferred],
    };
  }

  /** Build, then submit the run. Returns a handle carrying the run id. */
  submit(): WorkflowHandle {
    return this.submitFn(this.build());
  }

  /** Register a node + its incoming edges, rejecting duplicate names. */
  private addNode(name: string, after: string | string[] | undefined): void {
    if (this.seen.has(name)) {
      throw new Error(`duplicate workflow step '${name}'`);
    }
    this.seen.add(name);
    this.nodes.push(name);
    const predecessors = after === undefined ? [] : Array.isArray(after) ? after : [after];
    for (const from of predecessors) {
      this.edges.push({ from, to: name });
    }
  }
}
