import { WorkflowError } from "../errors";
import { successorsOf, transitiveDeferred } from "./plan";
import type {
  CanvasStep,
  FanInStepOptions,
  FanOutStepOptions,
  GateStepOptions,
  StepMetadataJson,
  SubWorkflowStepOptions,
  WorkflowHandle,
  WorkflowSpec,
  WorkflowStepOptions,
} from "./types";

/** Sentinel task names for nodes that run no job of their own. */
const GATE_TASK = "__gate__";
const SUBWORKFLOW_TASK = "__subworkflow__";

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
  /** Child workflows keyed by their sub-workflow node name. */
  private readonly subWorkflows: Record<string, WorkflowSpec> = {};

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
      condition: options.condition,
      compensate: options.compensate,
      cache: options.cache
        ? JSON.stringify(options.cache === true ? {} : options.cache)
        : undefined,
    };
    this.stepArgs[name] = options.args ?? [];
    // Conditioned and cacheable steps are enqueued by the tracker once their
    // predecessors settle (to evaluate the condition / check the cache), not
    // statically at submit.
    if (options.condition || options.cache) {
      this.deferredSeeds.add(name);
    }
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

  /**
   * Add an approval gate. The run pauses here (status `waiting_approval`) until
   * resolved via `queue.workflows.resolveGate`/`approveGate`/`rejectGate`, or
   * until `timeoutMs` elapses (then `onTimeout` decides).
   */
  gate(name: string, options: GateStepOptions): this {
    this.addNode(name, options.after);
    this.stepMetadata[name] = {
      task_name: GATE_TASK,
      gate: JSON.stringify({
        timeoutMs: options.timeoutMs,
        onTimeout: options.onTimeout ?? "reject",
        message: options.message,
      }),
    };
    this.stepArgs[name] = [];
    this.deferredSeeds.add(name);
    return this;
  }

  /**
   * Add a sub-workflow step. At runtime the tracker submits `options.workflow`
   * as a child run and resolves this node when the child finalizes. Build the
   * child with `queue.workflows.define(...)….build()`.
   */
  subWorkflow(name: string, options: SubWorkflowStepOptions): this {
    this.addNode(name, options.after);
    this.stepMetadata[name] = { task_name: SUBWORKFLOW_TASK };
    this.stepArgs[name] = [];
    this.subWorkflows[name] = options.workflow;
    this.deferredSeeds.add(name);
    return this;
  }

  /**
   * Canvas shorthand — add a sequential chain where each step runs after the
   * previous one. The first runs after `options.after` (or as a root).
   */
  chain(steps: CanvasStep[], options: { after?: string | string[] } = {}): this {
    let after = options.after;
    for (const { name, task, ...stepOptions } of steps) {
      this.step(name, task, { ...stepOptions, after });
      after = name;
    }
    return this;
  }

  /**
   * Canvas shorthand — add a parallel group where every step runs after
   * `options.after` (or as roots).
   */
  group(steps: CanvasStep[], options: { after?: string | string[] } = {}): this {
    for (const { name, task, ...stepOptions } of steps) {
      this.step(name, task, { ...stepOptions, after: options.after });
    }
    return this;
  }

  /**
   * Canvas shorthand — a parallel `steps` group joined by `callback`, which runs
   * once every group member completes. The callback gets its own `args`; to
   * aggregate the members' *results*, use {@link WorkflowBuilder.fanOut} /
   * {@link WorkflowBuilder.fanIn} instead.
   */
  chord(
    steps: CanvasStep[],
    callback: CanvasStep,
    options: { after?: string | string[] } = {},
  ): this {
    this.group(steps, options);
    const { name, task, ...callbackOptions } = callback;
    this.step(name, task, { ...callbackOptions, after: steps.map((step) => step.name) });
    return this;
  }

  /** Materialize the validated spec without submitting. */
  build(): WorkflowSpec {
    const hasPredecessor = new Set(this.edges.map((edge) => edge.to));
    for (const edge of this.edges) {
      if (!this.seen.has(edge.from)) {
        throw new WorkflowError(`step '${edge.to}' depends on unknown step '${edge.from}'`);
      }
    }
    for (const [name, meta] of Object.entries(this.stepMetadata)) {
      // A fan-in node is only ever enqueued by its fan-out's completion, so its
      // `after` must point at a fan-out step — otherwise the run would hang.
      if (meta.fan_in) {
        const { from } = JSON.parse(meta.fan_in) as { from: string };
        if (!this.stepMetadata[from]?.fan_out) {
          throw new Error(
            `fan-in step '${name}' must target a fan-out step, but '${from}' is not one`,
          );
        }
      }
      // A cacheable root has no job at submit and nothing to trigger it, so it
      // would stall; require an upstream step.
      if (meta.cache && !hasPredecessor.has(name)) {
        throw new WorkflowError(`cacheable step '${name}' must have at least one predecessor`);
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
      subWorkflows: { ...this.subWorkflows },
    };
  }

  /** Build, then submit the run. Returns a handle carrying the run id. */
  submit(): WorkflowHandle {
    return this.submitFn(this.build());
  }

  /** Register a node + its incoming edges, rejecting duplicate names. */
  private addNode(name: string, after: string | string[] | undefined): void {
    if (this.seen.has(name)) {
      throw new WorkflowError(`duplicate workflow step '${name}'`);
    }
    this.seen.add(name);
    this.nodes.push(name);
    const predecessors = after === undefined ? [] : Array.isArray(after) ? after : [after];
    for (const from of predecessors) {
      this.edges.push({ from, to: name });
    }
  }
}
