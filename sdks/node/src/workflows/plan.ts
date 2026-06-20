// Shared DAG-structure helpers used by both the build-time {@link WorkflowBuilder}
// and the runtime {@link WorkflowTracker}. Pure functions — no I/O.

/** A directed edge `from → to` in a workflow DAG. */
export interface DagEdge {
  from: string;
  to: string;
}

/** Map each node to the nodes that depend on it (its direct successors). */
export function successorsOf(edges: readonly DagEdge[]): Map<string, string[]> {
  return adjacency(edges, (e) => [e.from, e.to]);
}

/** Map each node to its direct predecessors (the nodes it depends on). */
export function predecessorsOf(edges: readonly DagEdge[]): Map<string, string[]> {
  return adjacency(edges, (e) => [e.to, e.from]);
}

/** Build an adjacency map, picking the (key, value) node from each edge. */
function adjacency(
  edges: readonly DagEdge[],
  pick: (edge: DagEdge) => [string, string],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const [key, value] = pick(edge);
    const list = map.get(key);
    if (list) {
      list.push(value);
    } else {
      map.set(key, [value]);
    }
  }
  return map;
}

/**
 * The set of deferred nodes: the `seeds` (fan-out / fan-in nodes the tracker
 * enqueues on demand) plus every node reachable from them. A node downstream of
 * a deferred one has no static job to depend on, so it too must be enqueued by
 * the tracker once its predecessors settle.
 */
export function transitiveDeferred(
  seeds: Iterable<string>,
  successors: Map<string, string[]>,
): Set<string> {
  const deferred = new Set<string>();
  const stack = [...seeds];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (deferred.has(node)) {
      continue;
    }
    deferred.add(node);
    for (const succ of successors.get(node) ?? []) {
      stack.push(succ);
    }
  }
  return deferred;
}
