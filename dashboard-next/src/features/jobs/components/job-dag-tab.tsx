import { Link } from "@tanstack/react-router";
import { Workflow } from "lucide-react";
import { useMemo } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { DagData, DagEdge, DagNode, JobStatus } from "@/lib/api-types";
import { JOB_STATUS_LABEL } from "@/lib/status";

interface JobDagTabProps {
  dag: DagData | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

const STATUS_FILL: Record<JobStatus, string> = {
  pending: "var(--surface-3)",
  running: "var(--color-info-dim)",
  complete: "var(--color-success-dim)",
  failed: "var(--color-danger-dim)",
  dead: "var(--color-danger-dim)",
  cancelled: "var(--color-warning-dim)",
};

const STATUS_STROKE: Record<JobStatus, string> = {
  pending: "var(--border-strong)",
  running: "var(--color-info)",
  complete: "var(--color-success)",
  failed: "var(--color-danger)",
  dead: "var(--color-danger)",
  cancelled: "var(--color-warning)",
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 58;
const LAYER_GAP_X = 80;
const NODE_GAP_Y = 24;
const PADDING = 32;

interface LaidOutNode extends DagNode {
  x: number;
  y: number;
  layer: number;
}

/**
 * Lay out DAG nodes in BFS layers from sources (nodes with no inbound edges).
 * Each layer's nodes are centered vertically so the graph is readable even
 * for lopsided fan-outs. Returns positioned nodes plus canvas dimensions.
 */
function layout(data: DagData): { nodes: LaidOutNode[]; width: number; height: number } {
  const nodes = data.nodes;
  const edges = data.edges;
  if (nodes.length === 0) return { nodes: [], width: 0, height: 0 };

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
  // Handle cycles defensively: any node we haven't ranked sits on layer 0.
  if (queue.length === 0 && nodes.length > 0) {
    layerOf.set(nodes[0]!.id, 0);
    queue.push(nodes[0]!.id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const depth = layerOf.get(id) ?? 0;
    for (const child of outgoing.get(id) ?? []) {
      const nextDepth = depth + 1;
      if ((layerOf.get(child) ?? -1) < nextDepth) {
        layerOf.set(child, nextDepth);
        queue.push(child);
      }
    }
  }

  const layers = new Map<number, string[]>();
  for (const n of nodes) {
    const layer = layerOf.get(n.id) ?? 0;
    const bucket = layers.get(layer) ?? [];
    bucket.push(n.id);
    layers.set(layer, bucket);
  }

  const sortedLayers = [...layers.entries()].sort(([a], [b]) => a - b);
  const tallestLayerSize = sortedLayers.reduce((max, [, ids]) => Math.max(max, ids.length), 0);
  const canvasHeight =
    PADDING * 2 + tallestLayerSize * NODE_HEIGHT + (tallestLayerSize - 1) * NODE_GAP_Y;
  const canvasWidth =
    PADDING * 2 + sortedLayers.length * NODE_WIDTH + (sortedLayers.length - 1) * LAYER_GAP_X;

  const laidOut: LaidOutNode[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
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

  return { nodes: laidOut, width: canvasWidth, height: canvasHeight };
}

export function JobDagTab({ dag, loading, error, onRetry }: JobDagTabProps) {
  const layoutResult = useMemo(
    () => (dag ? layout(dag) : { nodes: [], width: 0, height: 0 }),
    [dag],
  );

  if (error) {
    return <ErrorState title="Couldn't load DAG" description={error.message} onRetry={onRetry} />;
  }

  if (loading && !dag) return <Skeleton className="h-96 w-full" />;

  if (!dag || dag.nodes.length === 0) {
    return (
      <EmptyState
        icon={Workflow}
        title="No sub-workflow graph"
        description="This job isn't part of a chain or batch."
      />
    );
  }

  const positions = new Map(layoutResult.nodes.map((n) => [n.id, n]));

  return (
    <div className="overflow-auto rounded-lg bg-[var(--surface)] p-4 ring-1 ring-inset ring-[var(--border)]">
      <svg
        width={layoutResult.width}
        height={layoutResult.height}
        viewBox={`0 0 ${layoutResult.width} ${layoutResult.height}`}
        role="img"
        aria-label="Sub-workflow graph"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 -5 10 10"
            refX="9"
            refY="0"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0,-4 L 10,0 L 0,4" fill="var(--fg-subtle)" />
          </marker>
        </defs>
        <g>
          {dag.edges.map((edge) => (
            <Edge key={`${edge.from}-${edge.to}`} edge={edge} positions={positions} />
          ))}
        </g>
        <g>
          {layoutResult.nodes.map((node) => (
            <Node key={node.id} node={node} />
          ))}
        </g>
      </svg>
    </div>
  );
}

function Edge({ edge, positions }: { edge: DagEdge; positions: Map<string, LaidOutNode> }) {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return null;

  const x1 = from.x + NODE_WIDTH;
  const y1 = from.y + NODE_HEIGHT / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_HEIGHT / 2;
  const mid = (x1 + x2) / 2;
  const d = `M ${x1},${y1} C ${mid},${y1} ${mid},${y2} ${x2},${y2}`;
  return (
    <path
      d={d}
      fill="none"
      stroke="var(--fg-subtle)"
      strokeWidth="1.5"
      markerEnd="url(#arrow)"
      opacity={0.6}
    />
  );
}

function Node({ node }: { node: LaidOutNode }) {
  return (
    <g transform={`translate(${node.x}, ${node.y})`}>
      <Link to="/jobs/$id" params={{ id: node.id }}>
        <rect
          width={NODE_WIDTH}
          height={NODE_HEIGHT}
          rx={8}
          fill={STATUS_FILL[node.status]}
          stroke={STATUS_STROKE[node.status]}
          strokeWidth={1.5}
          className="transition-opacity hover:opacity-80"
        />
        <text
          x={12}
          y={22}
          fill="var(--fg)"
          fontSize="12"
          fontFamily="var(--font-sans)"
          fontWeight="500"
        >
          {truncate(node.task_name, 22)}
        </text>
        <text x={12} y={40} fill="var(--fg-subtle)" fontSize="10" fontFamily="var(--font-mono)">
          {node.id.slice(0, 8)}…
        </text>
        <text
          x={NODE_WIDTH - 12}
          y={40}
          textAnchor="end"
          fill={STATUS_STROKE[node.status]}
          fontSize="10"
          fontFamily="var(--font-sans)"
          fontWeight="600"
        >
          {JOB_STATUS_LABEL[node.status].toUpperCase()}
        </text>
      </Link>
    </g>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
