/**
 * Layered DAG layout for workflow nodes.
 *
 * The Rust dagron `to_json()` output has shape:
 *   { nodes: [{ name: string }], edges: [{ from: string, to: string }] }
 *
 * We combine that with per-node status from the run-detail endpoint to
 * produce a list of positioned nodes plus the canvas dimensions. The
 * algorithm mirrors `features/jobs/components/dag-layout.ts` — BFS layer
 * assignment from sources, vertical centering per layer.
 */

import type { WorkflowNodeStatus } from "../types";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 64;
export const LAYER_GAP_X = 100;
export const NODE_GAP_Y = 28;
export const PADDING = 32;

export interface RawDagNode {
  name: string;
}

export interface RawDagEdge {
  from: string;
  to: string;
}

export interface RawDagData {
  nodes: RawDagNode[];
  edges: RawDagEdge[];
}

export interface LaidOutWorkflowNode {
  name: string;
  status: WorkflowNodeStatus | "unknown";
  x: number;
  y: number;
  layer: number;
}

export interface WorkflowLayout {
  nodes: LaidOutWorkflowNode[];
  edges: RawDagEdge[];
  width: number;
  height: number;
}

export function parseDagJson(raw: string): RawDagData {
  try {
    const parsed = JSON.parse(raw);
    return {
      nodes: Array.isArray(parsed?.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed?.edges) ? parsed.edges : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

export function layout(
  dag: RawDagData,
  statuses: Record<string, WorkflowNodeStatus>,
): WorkflowLayout {
  const { nodes, edges } = dag;
  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const layerOf = assignLayers(nodes, edges);
  const layers = groupByLayer(nodes, layerOf);
  const sortedLayers = [...layers.entries()].sort(([a], [b]) => a - b);

  const { width, height } = canvasSize(sortedLayers);
  const laidOut = positionNodes(sortedLayers, height, statuses);

  return { nodes: laidOut, edges, width, height };
}

function assignLayers(nodes: RawDagNode[], edges: RawDagEdge[]): Map<string, number> {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.name, 0);
  for (const e of edges) {
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    const arr = outgoing.get(e.from);
    if (arr) arr.push(e.to);
    else outgoing.set(e.from, [e.to]);
  }

  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if ((incoming.get(n.name) ?? 0) === 0) {
      layer.set(n.name, 0);
      queue.push(n.name);
    }
  }
  // Cycle defence: if there were no sources, seed with the first node.
  const first = nodes[0];
  if (queue.length === 0 && first !== undefined) {
    layer.set(first.name, 0);
    queue.push(first.name);
  }

  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    const currentLayer = layer.get(current) ?? 0;
    for (const successor of outgoing.get(current) ?? []) {
      const nextLayer = currentLayer + 1;
      if ((layer.get(successor) ?? -1) < nextLayer) {
        layer.set(successor, nextLayer);
        queue.push(successor);
      }
    }
  }
  return layer;
}

function groupByLayer(
  nodes: RawDagNode[],
  layerOf: Map<string, number>,
): Map<number, RawDagNode[]> {
  const layers = new Map<number, RawDagNode[]>();
  for (const node of nodes) {
    const l = layerOf.get(node.name) ?? 0;
    const arr = layers.get(l);
    if (arr) arr.push(node);
    else layers.set(l, [node]);
  }
  return layers;
}

function canvasSize(sortedLayers: [number, RawDagNode[]][]): { width: number; height: number } {
  const maxNodesInLayer = sortedLayers.reduce((max, [, nodes]) => Math.max(max, nodes.length), 0);
  const width =
    sortedLayers.length * NODE_WIDTH +
    Math.max(0, sortedLayers.length - 1) * LAYER_GAP_X +
    PADDING * 2;
  const height =
    maxNodesInLayer * NODE_HEIGHT + Math.max(0, maxNodesInLayer - 1) * NODE_GAP_Y + PADDING * 2;
  return { width, height };
}

function positionNodes(
  sortedLayers: [number, RawDagNode[]][],
  canvasHeight: number,
  statuses: Record<string, WorkflowNodeStatus>,
): LaidOutWorkflowNode[] {
  const out: LaidOutWorkflowNode[] = [];
  for (const [layer, nodes] of sortedLayers) {
    const totalH = nodes.length * NODE_HEIGHT + (nodes.length - 1) * NODE_GAP_Y;
    const startY = (canvasHeight - totalH) / 2;
    const x = PADDING + layer * (NODE_WIDTH + LAYER_GAP_X);
    nodes.forEach((node, i) => {
      out.push({
        name: node.name,
        status: statuses[node.name] ?? "unknown",
        x,
        y: startY + i * (NODE_HEIGHT + NODE_GAP_Y),
        layer,
      });
    });
  }
  return out;
}
