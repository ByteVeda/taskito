import { route } from "preact-router";
import type { DagData, DagNode, JobStatus } from "../api/types";

interface DagViewerProps {
  dag: DagData;
}

const STATUS_COLORS: Record<JobStatus, string> = {
  pending: "#ffa726",
  running: "#42a5f5",
  complete: "#66bb6a",
  failed: "#ef5350",
  dead: "#ef5350",
  cancelled: "#a0a0b0",
};

export function DagViewer({ dag }: DagViewerProps) {
  if (!dag.nodes || dag.nodes.length <= 1) return null;

  const nodeW = 160;
  const nodeH = 36;
  const gapX = 40;
  const gapY = 20;

  // Build adjacency and in-degree
  const adj: Record<string, string[]> = {};
  const inDeg: Record<string, number> = {};
  dag.nodes.forEach((n) => {
    adj[n.id] = [];
    inDeg[n.id] = 0;
  });
  dag.edges.forEach((e) => {
    if (!adj[e.from]) adj[e.from] = [];
    adj[e.from].push(e.to);
    inDeg[e.to] = (inDeg[e.to] || 0) + 1;
  });

  // BFS layer assignment
  const layers: string[][] = [];
  const placed = new Set<string>();
  let queue = dag.nodes.filter((n) => (inDeg[n.id] || 0) === 0).map((n) => n.id);
  while (queue.length) {
    layers.push([...queue]);
    for (const id of queue) placed.add(id);
    const next: string[] = [];
    queue.forEach((id) => {
      (adj[id] || []).forEach((to) => {
        if (!placed.has(to) && !next.includes(to)) next.push(to);
      });
    });
    queue = next;
  }
  dag.nodes.forEach((n) => {
    if (!placed.has(n.id)) {
      layers.push([n.id]);
      placed.add(n.id);
    }
  });

  const nodeMap: Record<string, DagNode> = {};
  for (const n of dag.nodes) nodeMap[n.id] = n;

  const positions: Record<string, { x: number; y: number }> = {};
  let svgW = 0;
  let svgH = 0;
  layers.forEach((layer, li) => {
    layer.forEach((id, ni) => {
      const x = 20 + li * (nodeW + gapX);
      const y = 20 + ni * (nodeH + gapY);
      positions[id] = { x, y };
      svgW = Math.max(svgW, x + nodeW + 20);
      svgH = Math.max(svgH, y + nodeH + 20);
    });
  });

  return (
    <div class="mt-4">
      <h3 class="text-sm text-muted mb-2">Dependency Graph</h3>
      <div class="dark:bg-surface-2 bg-white rounded-lg shadow-sm dark:shadow-black/30 p-4 overflow-x-auto border border-transparent dark:border-white/5">
        <svg width={svgW} height={svgH} role="img" aria-label="Job dependency graph">
          <title>Job dependency graph</title>
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#a0a0b0" />
            </marker>
          </defs>
          {dag.edges.map((e, i) => {
            const from = positions[e.from];
            const to = positions[e.to];
            if (!from || !to) return null;
            return (
              <line
                key={i}
                x1={from.x + nodeW}
                y1={from.y + nodeH / 2}
                x2={to.x}
                y2={to.y + nodeH / 2}
                stroke="#a0a0b0"
                stroke-width="1.5"
                fill="none"
                marker-end="url(#arrow)"
              />
            );
          })}
          {dag.nodes.map((n) => {
            const p = positions[n.id];
            if (!p) return null;
            const color = STATUS_COLORS[n.status] || "#a0a0b0";
            return (
              <g key={n.id} class="cursor-pointer" onClick={() => route(`/jobs/${n.id}`)}>
                <rect
                  x={p.x}
                  y={p.y}
                  width={nodeW}
                  height={nodeH}
                  fill={`${color}22`}
                  stroke={color}
                  stroke-width="1.5"
                  rx="6"
                  ry="6"
                />
                <text x={p.x + 8} y={p.y + 14} fill={color} font-size="10" font-weight="600">
                  {n.status.toUpperCase()}
                </text>
                <text x={p.x + 8} y={p.y + 28} font-size="10" fill="#a0a0b0">
                  {n.task_name.length > 18 ? n.task_name.slice(-18) : n.task_name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
