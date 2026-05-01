import type { DagData, DagNode } from "@/lib/api-types";

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 58;
export const LAYER_GAP_X = 80;
export const NODE_GAP_Y = 24;
export const PADDING = 32;

export interface LaidOutNode extends DagNode {
  x: number;
  y: number;
  layer: number;
}

export interface LayoutResult {
  nodes: LaidOutNode[];
  width: number;
  height: number;
}

/**
 * Lay out DAG nodes in BFS layers from sources (nodes with no inbound edges).
 * Each layer's nodes are centered vertically so the graph is readable even for
 * lopsided fan-outs. Cycles are handled defensively by seeding layer 0 with
 * the first node when no source exists.
 */
export function layout(data: DagData): LayoutResult {
  const { nodes, edges } = data;
  if (nodes.length === 0) return { nodes: [], width: 0, height: 0 };

  const layerOf = assignLayers(nodes, edges);
  const layers = groupByLayer(nodes, layerOf);
  const sortedLayers = [...layers.entries()].sort(([a], [b]) => a - b);

  const { width, height } = canvasSize(sortedLayers);
  const laidOut = positionNodes(nodes, sortedLayers, height);

  return { nodes: laidOut, width, height };
}

function assignLayers(nodes: DagNode[], edges: DagData["edges"]): Map<string, number> {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, 0);
  for (const e of edges) {
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    const arr = outgoing.get(e.from);
    if (arr) arr.push(e.to);
    else outgoing.set(e.from, [e.to]);
  }

  const layerOf = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if ((incoming.get(n.id) ?? 0) === 0) {
      layerOf.set(n.id, 0);
      queue.push(n.id);
    }
  }
  if (queue.length === 0) {
    layerOf.set(nodes[0]!.id, 0);
    queue.push(nodes[0]!.id);
  }

  // Cap depth at nodes.length - 1 so cycles can't push layers up forever.
  // The longest acyclic path through N nodes has N-1 edges, so any layer
  // beyond that signals a back-edge in a cycle and is safe to drop.
  const maxLayer = Math.max(0, nodes.length - 1);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const depth = layerOf.get(id) ?? 0;
    if (depth >= maxLayer) continue;
    for (const child of outgoing.get(id) ?? []) {
      const nextDepth = depth + 1;
      if ((layerOf.get(child) ?? -1) < nextDepth) {
        layerOf.set(child, nextDepth);
        queue.push(child);
      }
    }
  }

  return layerOf;
}

function groupByLayer(nodes: DagNode[], layerOf: Map<string, number>): Map<number, string[]> {
  const layers = new Map<number, string[]>();
  for (const n of nodes) {
    const layer = layerOf.get(n.id) ?? 0;
    const bucket = layers.get(layer) ?? [];
    bucket.push(n.id);
    layers.set(layer, bucket);
  }
  return layers;
}

function canvasSize(sortedLayers: [number, string[]][]): { width: number; height: number } {
  const tallestLayerSize = sortedLayers.reduce((max, [, ids]) => Math.max(max, ids.length), 0);
  const height = PADDING * 2 + tallestLayerSize * NODE_HEIGHT + (tallestLayerSize - 1) * NODE_GAP_Y;
  const width =
    PADDING * 2 + sortedLayers.length * NODE_WIDTH + (sortedLayers.length - 1) * LAYER_GAP_X;
  return { width, height };
}

function positionNodes(
  nodes: DagNode[],
  sortedLayers: [number, string[]][],
  canvasHeight: number,
): LaidOutNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const laidOut: LaidOutNode[] = [];
  for (const [layer, ids] of sortedLayers) {
    const layerHeight = ids.length * NODE_HEIGHT + (ids.length - 1) * NODE_GAP_Y;
    const startY = (canvasHeight - layerHeight) / 2;
    ids.forEach((id, i) => {
      const base = byId.get(id);
      if (!base) return;
      laidOut.push({
        ...base,
        layer,
        x: PADDING + layer * (NODE_WIDTH + LAYER_GAP_X),
        y: startY + i * (NODE_HEIGHT + NODE_GAP_Y),
      });
    });
  }
  return laidOut;
}
