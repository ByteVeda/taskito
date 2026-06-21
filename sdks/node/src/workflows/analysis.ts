import type { WorkflowNode } from "./types";

/** A node in the serialized workflow graph. */
export interface GraphNode {
  name: string;
}

/** A directed dependency edge (`from` runs before `to`). */
export interface GraphEdge {
  from: string;
  to: string;
  weight?: number;
}

/** The serialized workflow graph, as returned (JSON) by `workflows.dag()`. */
export interface WorkflowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Aggregate counts for a run's nodes. */
export interface WorkflowStats {
  /** Total node count. */
  total: number;
  /** Count keyed by lowercase node status. */
  byStatus: Record<string, number>;
  completed: number;
  failed: number;
  running: number;
  /** Nodes neither running nor terminal (pending/ready/waiting). */
  pending: number;
}

const TERMINAL_FAILURE = new Set(["failed", "compensation_failed"]);

/**
 * Structural and status analysis of a workflow run's DAG. Built from the graph
 * (`workflows.dag()`) plus per-node statuses (`workflows.nodes()`); all methods
 * are pure graph computation over that snapshot.
 *
 * Obtain one via `queue.workflows.analyze(runId)`.
 */
export class WorkflowAnalysis {
  /** Node names in graph order. */
  readonly nodeNames: readonly string[];
  private readonly predecessors = new Map<string, string[]>();
  private readonly successors = new Map<string, string[]>();
  private readonly nodeByName = new Map<string, WorkflowNode>();

  constructor(graph: WorkflowGraph, nodes: readonly WorkflowNode[]) {
    this.nodeNames = graph.nodes.map((node) => node.name);
    for (const name of this.nodeNames) {
      this.predecessors.set(name, []);
      this.successors.set(name, []);
    }
    for (const edge of graph.edges) {
      this.successors.get(edge.from)?.push(edge.to);
      this.predecessors.get(edge.to)?.push(edge.from);
    }
    for (const node of nodes) {
      this.nodeByName.set(node.nodeName, node);
    }
  }

  /** The status record for a node, or `undefined` if it has none yet. */
  node(name: string): WorkflowNode | undefined {
    return this.nodeByName.get(name);
  }

  /** Entry nodes — those with no predecessors. */
  roots(): string[] {
    return this.nodeNames.filter((name) => this.predecessors.get(name)?.length === 0);
  }

  /** Exit nodes — those with no successors. */
  leaves(): string[] {
    return this.nodeNames.filter((name) => this.successors.get(name)?.length === 0);
  }

  /** All transitive predecessors of `name` (its upstream dependencies). */
  ancestors(name: string): string[] {
    return this.reachable(name, this.predecessors);
  }

  /** All transitive successors of `name` (everything that depends on it). */
  descendants(name: string): string[] {
    return this.reachable(name, this.successors);
  }

  /** A topological ordering (Kahn's algorithm); throws on a cycle. */
  topologicalOrder(): string[] {
    const indegree = new Map<string, number>();
    for (const name of this.nodeNames) {
      indegree.set(name, this.predecessors.get(name)?.length ?? 0);
    }
    const queue = this.nodeNames.filter((name) => indegree.get(name) === 0);
    const order: string[] = [];
    while (queue.length > 0) {
      const name = queue.shift() as string;
      order.push(name);
      for (const next of this.successors.get(name) ?? []) {
        const remaining = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, remaining);
        if (remaining === 0) {
          queue.push(next);
        }
      }
    }
    if (order.length !== this.nodeNames.length) {
      throw new Error("workflow graph has a cycle");
    }
    return order;
  }

  /** Nodes grouped by dependency depth: level 0 = roots, level n = longest path from a root. */
  topologicalLevels(): string[][] {
    const depth = this.longestDepth();
    const levels: string[][] = [];
    for (const name of this.nodeNames) {
      const d = depth.get(name) ?? 0;
      let bucket = levels[d];
      if (!bucket) {
        bucket = [];
        levels[d] = bucket;
      }
      bucket.push(name);
    }
    return levels.map((level) => level ?? []);
  }

  /**
   * The structural critical path — the longest chain of dependencies, by node
   * count. Returned as the node sequence from a root to a leaf.
   */
  criticalPath(): string[] {
    const order = this.topologicalOrder();
    const length = new Map<string, number>();
    const parent = new Map<string, string | null>();
    let endNode = order[0] ?? null;
    let best = 0;
    for (const name of order) {
      let bestPred: string | null = null;
      let bestLen = 0;
      for (const pred of this.predecessors.get(name) ?? []) {
        const len = length.get(pred) ?? 0;
        if (len > bestLen) {
          bestLen = len;
          bestPred = pred;
        }
      }
      length.set(name, bestLen + 1);
      parent.set(name, bestPred);
      if (bestLen + 1 > best) {
        best = bestLen + 1;
        endNode = name;
      }
    }
    const path: string[] = [];
    for (let at = endNode; at !== null; at = parent.get(at) ?? null) {
      path.push(at);
    }
    return path.reverse();
  }

  /** Aggregate node counts by status. */
  stats(): WorkflowStats {
    const byStatus: Record<string, number> = {};
    let completed = 0;
    let failed = 0;
    let running = 0;
    // `skipped` is terminal (a pruned branch never runs), so it must not fall
    // into `pending` via the remainder below.
    let skipped = 0;
    for (const name of this.nodeNames) {
      const status = this.nodeByName.get(name)?.status ?? "pending";
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (status === "completed") {
        completed += 1;
      } else if (TERMINAL_FAILURE.has(status)) {
        failed += 1;
      } else if (status === "running") {
        running += 1;
      } else if (status === "skipped") {
        skipped += 1;
      }
    }
    const total = this.nodeNames.length;
    return {
      total,
      byStatus,
      completed,
      failed,
      running,
      pending: total - completed - failed - running - skipped,
    };
  }

  /** Transitive closure of `name` over `edges`, excluding `name` itself. */
  private reachable(name: string, edges: Map<string, string[]>): string[] {
    const seen = new Set<string>();
    const stack = [...(edges.get(name) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      stack.push(...(edges.get(next) ?? []));
    }
    return [...seen];
  }

  /** Longest-path depth from any root for every node (memoized over topo order). */
  private longestDepth(): Map<string, number> {
    const depth = new Map<string, number>();
    for (const name of this.topologicalOrder()) {
      let max = 0;
      for (const pred of this.predecessors.get(name) ?? []) {
        max = Math.max(max, (depth.get(pred) ?? 0) + 1);
      }
      depth.set(name, max);
    }
    return depth;
  }
}
