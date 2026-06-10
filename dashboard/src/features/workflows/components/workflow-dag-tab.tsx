import { GitBranch } from "lucide-react";
import { useMemo } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { WorkflowNodeStatus } from "@/lib/api-types";
import { TONE_VAR, WORKFLOW_NODE_LABEL, WORKFLOW_NODE_TONE } from "@/lib/status";

interface DagNode {
  name: string;
  status: WorkflowNodeStatus;
  deps: string[];
}

interface ParsedDag {
  nodes: DagNode[];
  edges: Array<{ from: string; to: string }>;
}

const NODE_W = 180;
const NODE_H = 58;
const GAP_X = 80;
const GAP_Y = 24;
const PAD = 32;

interface LaidOut extends DagNode {
  x: number;
  y: number;
}

interface LayoutResult {
  nodes: LaidOut[];
  width: number;
  height: number;
}

interface Props {
  dagJson: string | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function WorkflowDagTab({ dagJson, loading, error, onRetry }: Props) {
  const parsed = useMemo(() => (dagJson ? parseDag(dagJson) : null), [dagJson]);
  const result = useMemo(() => (parsed ? layoutDag(parsed) : null), [parsed]);

  if (error) {
    return <ErrorState title="Couldn't load DAG" description={error.message} onRetry={onRetry} />;
  }

  if (loading && !dagJson) return <Skeleton className="h-96 w-full" />;

  if (!result || result.nodes.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="No DAG available"
        description="This workflow has no definition graph."
      />
    );
  }

  const positions = new Map(result.nodes.map((n) => [n.name, n]));

  return (
    <div className="overflow-auto rounded-lg bg-[var(--surface)] p-4 ring-1 ring-inset ring-[var(--border)]">
      <svg
        width={result.width}
        height={result.height}
        viewBox={`0 0 ${result.width} ${result.height}`}
        role="img"
        aria-label="Workflow DAG"
      >
        <defs>
          <marker
            id="wf-arrow"
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
          {parsed?.edges.map((e) => {
            const from = positions.get(e.from);
            const to = positions.get(e.to);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`${e.from}-${e.to}`}
                d={`M ${x1},${y1} C ${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                fill="none"
                stroke="var(--fg-subtle)"
                strokeWidth="1.5"
                markerEnd="url(#wf-arrow)"
                opacity={0.6}
              />
            );
          })}
        </g>
        <g>
          {result.nodes.map((node) => {
            const tone = WORKFLOW_NODE_TONE[node.status];
            const color = TONE_VAR[tone];
            return (
              <g key={node.name} transform={`translate(${node.x}, ${node.y})`}>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="var(--surface-2)"
                  stroke={color}
                  strokeWidth={1.5}
                />
                <text
                  x={12}
                  y={22}
                  fill="var(--fg)"
                  fontSize="12"
                  fontFamily="var(--font-sans)"
                  fontWeight="500"
                >
                  {node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name}
                </text>
                <text
                  x={NODE_W - 12}
                  y={42}
                  textAnchor="end"
                  fill={color}
                  fontSize="10"
                  fontFamily="var(--font-sans)"
                  fontWeight="600"
                >
                  {WORKFLOW_NODE_LABEL[node.status].toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function parseDag(raw: string): ParsedDag {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const nodes: DagNode[] = [];
    const edges: ParsedDag["edges"] = [];

    if (Array.isArray(data.nodes)) {
      for (const n of data.nodes) {
        const name = String(n.name ?? n.node_name ?? "");
        const status = (n.status ?? "pending") as WorkflowNodeStatus;
        const deps = Array.isArray(n.deps) ? n.deps.map(String) : [];
        nodes.push({ name, status, deps });
        for (const dep of deps) {
          edges.push({ from: dep, to: name });
        }
      }
    }

    return { nodes, edges };
  } catch {
    return { nodes: [], edges: [] };
  }
}

function layoutDag(dag: ParsedDag): LayoutResult {
  if (dag.nodes.length === 0) return { nodes: [], width: 0, height: 0 };

  const layerOf = new Map<string, number>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const n of dag.nodes) incoming.set(n.name, 0);
  for (const e of dag.edges) {
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    const arr = outgoing.get(e.from);
    if (arr) arr.push(e.to);
    else outgoing.set(e.from, [e.to]);
  }

  const queue: string[] = [];
  for (const n of dag.nodes) {
    if ((incoming.get(n.name) ?? 0) === 0) {
      layerOf.set(n.name, 0);
      queue.push(n.name);
    }
  }
  if (queue.length === 0) {
    layerOf.set(dag.nodes[0]!.name, 0);
    queue.push(dag.nodes[0]!.name);
  }

  const maxLayer = Math.max(0, dag.nodes.length - 1);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const depth = layerOf.get(id) ?? 0;
    if (depth >= maxLayer) continue;
    for (const child of outgoing.get(id) ?? []) {
      if ((layerOf.get(child) ?? -1) < depth + 1) {
        layerOf.set(child, depth + 1);
        queue.push(child);
      }
    }
  }

  const layers = new Map<number, string[]>();
  for (const n of dag.nodes) {
    const l = layerOf.get(n.name) ?? 0;
    const arr = layers.get(l) ?? [];
    arr.push(n.name);
    layers.set(l, arr);
  }

  const sorted = [...layers.entries()].sort(([a], [b]) => a - b);
  const tallest = sorted.reduce((m, [, ids]) => Math.max(m, ids.length), 0);
  const height = PAD * 2 + tallest * NODE_H + (tallest - 1) * GAP_Y;
  const width = PAD * 2 + sorted.length * NODE_W + (sorted.length - 1) * GAP_X;

  const byName = new Map(dag.nodes.map((n) => [n.name, n]));
  const laidOut: LaidOut[] = [];
  for (const [layer, ids] of sorted) {
    const lh = ids.length * NODE_H + (ids.length - 1) * GAP_Y;
    const startY = (height - lh) / 2;
    ids.forEach((name, i) => {
      const base = byName.get(name);
      if (!base) return;
      laidOut.push({
        ...base,
        x: PAD + layer * (NODE_W + GAP_X),
        y: startY + i * (NODE_H + GAP_Y),
      });
    });
  }

  return { nodes: laidOut, width, height };
}
