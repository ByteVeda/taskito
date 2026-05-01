import { Link } from "@tanstack/react-router";
import { Workflow } from "lucide-react";
import { useMemo } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { DagData, DagEdge, JobStatus } from "@/lib/api-types";
import { JOB_STATUS_LABEL } from "@/lib/status";
import { type LaidOutNode, layout, NODE_HEIGHT, NODE_WIDTH } from "./dag-layout";

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
