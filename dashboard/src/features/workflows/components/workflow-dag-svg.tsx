/**
 * SVG renderer for the workflow DAG.
 *
 * Reads the raw DAG JSON string from the API plus per-node status from the
 * detail endpoint, lays out the nodes in vertical layers, and draws a static
 * SVG. Nodes are coloured by status; edges are simple straight lines.
 *
 * No external graph library — we intentionally keep this small. Operators
 * who need pan / zoom can use the browser zoom; the typical workflow has
 * fewer than 50 nodes and fits comfortably in a single viewport.
 */

import type { WorkflowNode, WorkflowNodeStatus } from "../types";
import {
  type LaidOutWorkflowNode,
  layout,
  NODE_HEIGHT,
  NODE_WIDTH,
  parseDagJson,
} from "./workflow-dag-layout";

interface WorkflowDagSvgProps {
  dagRaw: string;
  nodes: WorkflowNode[];
}

const STATUS_FILL: Record<WorkflowNodeStatus | "unknown", string> = {
  pending: "#e5e7eb",
  ready: "#dbeafe",
  running: "#3b82f6",
  completed: "#10b981",
  failed: "#ef4444",
  skipped: "#9ca3af",
  waiting_approval: "#f59e0b",
  cache_hit: "#8b5cf6",
  compensating: "#f97316",
  compensated: "#06b6d4",
  compensation_failed: "#dc2626",
  unknown: "#d1d5db",
};

const STATUS_TEXT: Record<WorkflowNodeStatus | "unknown", string> = {
  pending: "#111827",
  ready: "#111827",
  running: "#ffffff",
  completed: "#ffffff",
  failed: "#ffffff",
  skipped: "#ffffff",
  waiting_approval: "#111827",
  cache_hit: "#ffffff",
  compensating: "#ffffff",
  compensated: "#ffffff",
  compensation_failed: "#ffffff",
  unknown: "#111827",
};

export function WorkflowDagSvg({ dagRaw, nodes }: WorkflowDagSvgProps) {
  const statuses: Record<string, WorkflowNodeStatus> = {};
  for (const n of nodes) statuses[n.node_name] = n.status;

  const dag = parseDagJson(dagRaw);
  const { nodes: laidOut, edges, width, height } = layout(dag, statuses);

  if (laidOut.length === 0) {
    return (
      <div className="rounded border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        No DAG data available for this run.
      </div>
    );
  }

  const nodeIndex = new Map<string, LaidOutWorkflowNode>();
  for (const n of laidOut) nodeIndex.set(n.name, n);

  return (
    <div className="overflow-auto rounded border bg-white">
      <svg width={width} height={height} role="img" aria-label="Workflow DAG">
        <title>Workflow DAG</title>
        {/* Edges */}
        {edges.map((e) => {
          const a = nodeIndex.get(e.from);
          const b = nodeIndex.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_WIDTH;
          const y1 = a.y + NODE_HEIGHT / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_HEIGHT / 2;
          return (
            <line
              key={`${e.from}->${e.to}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#94a3b8"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
          );
        })}
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>
        {/* Nodes */}
        {laidOut.map((n) => (
          <g key={n.name} transform={`translate(${n.x}, ${n.y})`}>
            <rect
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx={6}
              fill={STATUS_FILL[n.status]}
              stroke="#1f2937"
              strokeWidth={0.5}
            />
            <text
              x={NODE_WIDTH / 2}
              y={NODE_HEIGHT / 2 - 6}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="13"
              fontWeight={600}
              fill={STATUS_TEXT[n.status]}
            >
              {n.name}
            </text>
            <text
              x={NODE_WIDTH / 2}
              y={NODE_HEIGHT / 2 + 12}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="11"
              fill={STATUS_TEXT[n.status]}
              opacity={0.85}
            >
              {n.status}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
