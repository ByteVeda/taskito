import type { StepMetadataJson, WorkflowHandle, WorkflowSpec, WorkflowStepOptions } from "./types";

/**
 * Fluent builder for a workflow DAG. Each {@link WorkflowBuilder.step} adds a
 * node; `after` declares edges. Steps may reference predecessors that are added
 * later — the DAG is validated (and topologically ordered) at submit time.
 *
 * Obtain one via `queue.workflows.define(name)`; finish with `.submit()`.
 */
export class WorkflowBuilder {
  private readonly nodes: string[] = [];
  private readonly edges: Array<{ from: string; to: string }> = [];
  private readonly stepMetadata: Record<string, StepMetadataJson> = {};
  private readonly stepArgs: Record<string, unknown[]> = {};
  private readonly seen = new Set<string>();

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly submitFn: (spec: WorkflowSpec) => WorkflowHandle,
  ) {}

  /** Add a step `name` that runs the registered task `taskName`. */
  step(name: string, taskName: string, options: WorkflowStepOptions = {}): this {
    if (this.seen.has(name)) {
      throw new Error(`duplicate workflow step '${name}'`);
    }
    this.seen.add(name);
    this.nodes.push(name);

    const after =
      options.after === undefined
        ? []
        : Array.isArray(options.after)
          ? options.after
          : [options.after];
    for (const from of after) {
      this.edges.push({ from, to: name });
    }

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

  /** Materialize the validated spec without submitting. */
  build(): WorkflowSpec {
    for (const edge of this.edges) {
      if (!this.seen.has(edge.from)) {
        throw new Error(`step '${edge.to}' depends on unknown step '${edge.from}'`);
      }
    }
    return {
      name: this.name,
      version: this.version,
      nodes: [...this.nodes],
      edges: [...this.edges],
      stepMetadata: { ...this.stepMetadata },
      stepArgs: { ...this.stepArgs },
    };
  }

  /** Build, then submit the run. Returns a handle carrying the run id. */
  submit(): WorkflowHandle {
    return this.submitFn(this.build());
  }
}
