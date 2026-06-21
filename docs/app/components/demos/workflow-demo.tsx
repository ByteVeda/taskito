import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRafLoop, useReducedMotion } from "./lib";
import type { DemoProps } from "./types";

/*
 * Workflow DAG demo — a real dependency graph (chain → parallel group → chord
 * join → fan-out). Run it and execution propagates as each task's inputs become
 * ready; click a node to trace/run a branch. React port of demo-workflow.js
 * (SVG + RAF scheduler with lit edges + traveling dots).
 */

const W = 760;
const H = 372;
const NW = 120;
const NH = 46;

interface NodeDef {
  id: string;
  label: string;
  fn: string;
  type: string;
  x: number;
  y: number;
  dur: number;
}
const NODES: NodeDef[] = [
  {
    id: "ingest",
    label: "ingest",
    fn: "fetch_source()",
    type: "Source",
    x: 78,
    y: 186,
    dur: 700,
  },
  {
    id: "probe",
    label: "probe",
    fn: "inspect.s()",
    type: "Chain step",
    x: 222,
    y: 186,
    dur: 620,
  },
  {
    id: "t720",
    label: "transcode 720p",
    fn: "encode.s(720)",
    type: "Group · parallel",
    x: 392,
    y: 84,
    dur: 1500,
  },
  {
    id: "t1080",
    label: "transcode 1080p",
    fn: "encode.s(1080)",
    type: "Group · parallel",
    x: 392,
    y: 186,
    dur: 2000,
  },
  {
    id: "audio",
    label: "extract audio",
    fn: "audio.s()",
    type: "Group · parallel",
    x: 392,
    y: 288,
    dur: 1150,
  },
  {
    id: "package",
    label: "package",
    fn: "chord(mux.s())",
    type: "Chord · join",
    x: 560,
    y: 186,
    dur: 950,
  },
  {
    id: "notify",
    label: "notify",
    fn: "webhook.s()",
    type: "Fan-out",
    x: 704,
    y: 120,
    dur: 520,
  },
  {
    id: "cdn",
    label: "publish CDN",
    fn: "upload.s()",
    type: "Fan-out",
    x: 704,
    y: 252,
    dur: 760,
  },
];
const EDGES: [string, string][] = [
  ["ingest", "probe"],
  ["probe", "t720"],
  ["probe", "t1080"],
  ["probe", "audio"],
  ["t720", "package"],
  ["t1080", "package"],
  ["audio", "package"],
  ["package", "notify"],
  ["package", "cdn"],
];

const byId: Record<string, NodeDef & { deps: string[]; kids: string[] }> = {};
for (const n of NODES) byId[n.id] = { ...n, deps: [], kids: [] };
for (const [a, b] of EDGES) {
  byId[b].deps.push(a);
  byId[a].kids.push(b);
}

const CRIT = (() => {
  const memo: Record<string, number> = {};
  const cp = (id: string): number => {
    if (memo[id] != null) return memo[id];
    let m = 0;
    for (const k of byId[id].kids) m = Math.max(m, cp(k));
    memo[id] = byId[id].dur + m;
    return memo[id];
  };
  return Math.max(
    ...NODES.filter((n) => byId[n.id].deps.length === 0).map((n) => cp(n.id)),
  );
})();

const edgeKey = (a: string, b: string) => `${a}>${b}`;
function edgePath(a: NodeDef, b: NodeDef): string {
  const x1 = a.x + NW / 2;
  const y1 = a.y;
  const x2 = b.x - NW / 2;
  const y2 = b.y;
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function branchSet(rootId: string): Set<string> {
  const set = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const c = stack.pop() as string;
    for (const k of byId[c].kids) {
      if (!set.has(k)) {
        set.add(k);
        stack.push(k);
      }
    }
  }
  return set;
}
const inBranch = (rootId: string, id: string) => branchSet(rootId).has(id);

type Status = "idle" | "queued" | "running" | "done";
const COLOR: Record<
  Status,
  { fill: string; stroke: string; pip: string; t1: string }
> = {
  idle: {
    fill: "var(--panel2)",
    stroke: "var(--line2)",
    pip: "var(--dim)",
    t1: "var(--txt2)",
  },
  queued: {
    fill: "var(--indigo-soft)",
    stroke: "var(--indigo-line)",
    pip: "var(--indigo-br)",
    t1: "var(--txt)",
  },
  running: {
    fill: "color-mix(in oklch,var(--cyan) 15%,transparent)",
    stroke: "color-mix(in oklch,var(--cyan) 55%,transparent)",
    pip: "var(--cyan)",
    t1: "var(--txt)",
  },
  done: {
    fill: "color-mix(in oklch,var(--grn) 13%,transparent)",
    stroke: "color-mix(in oklch,var(--grn) 48%,transparent)",
    pip: "var(--grn)",
    t1: "var(--txt)",
  },
};

interface Sim {
  st: Record<string, Status>;
  finishAt: Record<string, number>;
  t0: number;
  elapsed: number;
  runMask: Set<string> | null;
  lit: Set<string>;
}
function freshSim(): Sim {
  const st: Record<string, Status> = {};
  for (const n of NODES) st[n.id] = "idle";
  return { st, finishAt: {}, t0: 0, elapsed: 0, runMask: null, lit: new Set() };
}

export default function WorkflowDemo(_props: DemoProps) {
  const reduced = useReducedMotion();
  const simRef = useRef<Sim>(freshSim());
  const lenRef = useRef<Map<string, number>>(new Map());
  const pathRef = useRef<Map<string, SVGPathElement>>(new Map());
  const flowRef = useRef<SVGGElement>(null);
  const [selected, setSelected] = useState<string | null>("ingest");
  const [running, setRunning] = useState(false);
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  // Measure each lit edge's length once mounted, then repaint to apply dasharray.
  useEffect(() => {
    for (const [a, b] of EDGES) {
      const p = pathRef.current.get(edgeKey(a, b));
      if (p) lenRef.current.set(edgeKey(a, b), p.getTotalLength());
    }
    repaint();
  }, []);

  const spawnDot = useCallback((key: string) => {
    const path = pathRef.current.get(key);
    const flow = flowRef.current;
    if (!path || !flow || typeof path.getPointAtLength !== "function") return;
    const len = path.getTotalLength();
    const dot = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    dot.setAttribute("r", "4");
    dot.setAttribute("fill", "var(--grn)");
    dot.style.filter = "drop-shadow(0 0 5px var(--grn))";
    flow.appendChild(dot);
    const start = performance.now();
    const DUR = 480;
    const move = (now: number) => {
      const p = Math.min(1, (now - start) / DUR);
      const pt = path.getPointAtLength(len * p);
      dot.setAttribute("cx", String(pt.x));
      dot.setAttribute("cy", String(pt.y));
      dot.style.opacity = String(
        p < 0.12 ? p / 0.12 : p > 0.85 ? 1 - (p - 0.85) / 0.15 : 1,
      );
      if (p < 1) requestAnimationFrame(move);
      else dot.remove();
    };
    requestAnimationFrame(move);
  }, []);

  const eligible = useCallback((sim: Sim, id: string): boolean => {
    if (sim.runMask && !sim.runMask.has(id)) return false;
    if (sim.st[id] !== "idle") return false;
    return byId[id].deps.every((d) =>
      sim.runMask && !sim.runMask.has(d) ? true : sim.st[d] === "done",
    );
  }, []);

  const litOut = useCallback(
    (sim: Sim, id: string) => {
      for (const k of byId[id].kids) {
        if (sim.runMask && !sim.runMask.has(k)) continue;
        const key = edgeKey(id, k);
        if (!sim.lit.has(key)) {
          sim.lit.add(key);
          if (!reduced) spawnDot(key);
        }
      }
    },
    [reduced, spawnDot],
  );

  const tick = useCallback(
    (now: number) => {
      const sim = simRef.current;
      sim.elapsed = now - sim.t0;
      for (const n of NODES) {
        if (eligible(sim, n.id)) {
          sim.st[n.id] = "running";
          sim.finishAt[n.id] = now + n.dur;
        }
      }
      for (const n of NODES) {
        if (sim.st[n.id] === "running" && now >= sim.finishAt[n.id]) {
          sim.st[n.id] = "done";
          litOut(sim, n.id);
        }
      }
      const pending = NODES.some((n) => eligible(sim, n.id));
      const anyRunning = NODES.some((n) => sim.st[n.id] === "running");
      if (!anyRunning && !pending) setRunning(false);
      repaint();
    },
    [eligible, litOut],
  );

  useRafLoop(tick, running && !reduced);

  const instantFinish = useCallback((sim: Sim) => {
    for (const n of NODES) {
      if (!sim.runMask || sim.runMask.has(n.id)) sim.st[n.id] = "done";
    }
    for (const [a, b] of EDGES) {
      if (!sim.runMask || (sim.runMask.has(a) && sim.runMask.has(b)))
        sim.lit.add(edgeKey(a, b));
    }
    sim.elapsed = CRIT;
  }, []);

  const start = useCallback(
    (mask: Set<string> | null) => {
      const sim = freshSim();
      sim.runMask = mask;
      sim.t0 = performance.now();
      simRef.current = sim;
      if (reduced) {
        instantFinish(sim);
        setRunning(false);
        repaint();
      } else {
        setRunning(true);
      }
    },
    [reduced, instantFinish],
  );

  const reset = useCallback(() => {
    simRef.current = freshSim();
    setRunning(false);
    setSelected("ingest");
    repaint();
  }, []);

  // Auto-run on mount (matches the embed behavior); static-finish if reduced.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per motion preference; start is stable
  useEffect(() => {
    setSelected(null);
    start(null);
  }, [reduced]);

  const sim = simRef.current;
  const scope = NODES.filter((n) => !sim.runMask || sim.runMask.has(n.id));
  const doneCount = scope.filter((n) => sim.st[n.id] === "done").length;
  const runCount = scope.filter((n) => sim.st[n.id] === "running").length;

  const selNode = byId[selected ?? "ingest"];
  const selStatus = sim.st[selNode.id] ?? "idle";
  const selStColor = COLOR[selStatus].pip;
  const downstream = branchSet(selNode.id).size - 1;

  return (
    <div className="dm-frame-react">
      <div className="demo-bar">
        <span className="title">
          <span className="ld" />
          media-pipeline · DAG
        </span>
        <div className="demo-controls">
          <button
            type="button"
            className="ctl pri"
            disabled={running}
            onClick={() => {
              setSelected(null);
              start(null);
            }}
          >
            {running ? (
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
                aria-hidden="true"
              >
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
            {running ? "Running…" : "Run workflow"}
          </button>
          <button type="button" className="ctl" onClick={reset}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Reset
          </button>
        </div>
      </div>

      <div className="wf-grid">
        <div className="wf-graph">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="Workflow dependency graph: ingest then probe, fanning out to three parallel transcode tasks, joined by a package step, then publishing to notify and CDN. Run animates execution in dependency order."
          >
            <defs>
              <marker
                id="wf-ar"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth="9"
                markerHeight="9"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M1.5 1.5 L9 5 L1.5 8.5 Z" fill="var(--line3)" />
              </marker>
              <marker
                id="wf-ar-on"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth="9"
                markerHeight="9"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M1.5 1.5 L9 5 L1.5 8.5 Z" fill="var(--grn)" />
              </marker>
            </defs>

            {/* base edges */}
            <g>
              {EDGES.map(([a, b]) => {
                const key = edgeKey(a, b);
                return (
                  <path
                    key={key}
                    d={edgePath(byId[a], byId[b])}
                    fill="none"
                    stroke="var(--line2)"
                    strokeWidth="2"
                    markerEnd={
                      sim.lit.has(key) ? "url(#wf-ar-on)" : "url(#wf-ar)"
                    }
                  />
                );
              })}
            </g>

            {/* lit edges + traveling dots */}
            <g ref={flowRef}>
              {EDGES.map(([a, b]) => {
                const key = edgeKey(a, b);
                const len = lenRef.current.get(key) ?? 400;
                return (
                  <path
                    key={key}
                    ref={(el) => {
                      if (el) pathRef.current.set(key, el);
                      else pathRef.current.delete(key);
                    }}
                    d={edgePath(byId[a], byId[b])}
                    fill="none"
                    stroke="var(--grn)"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    style={{
                      strokeDasharray: len,
                      strokeDashoffset: sim.lit.has(key) ? 0 : len,
                      transition: "stroke-dashoffset .5s ease",
                    }}
                  />
                );
              })}
            </g>

            {/* nodes */}
            <g>
              {NODES.map((n) => {
                const status = sim.st[n.id];
                const c = COLOR[status];
                const isSel = selected === n.id;
                const dim = selected && !running && !inBranch(selected, n.id);
                return (
                  // biome-ignore lint/a11y/useSemanticElements: SVG <g> can't be an HTML <button>; role+key handlers give it button semantics
                  <g
                    key={n.id}
                    className="wf-node"
                    tabIndex={0}
                    role="button"
                    aria-label={`${n.label} — ${n.type}`}
                    style={{ opacity: dim ? 0.4 : 1 }}
                    onClick={() => setSelected(n.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(n.id);
                      }
                    }}
                  >
                    <rect
                      x={n.x - NW / 2}
                      y={n.y - NH / 2}
                      width={NW}
                      height={NH}
                      rx="11"
                      fill={c.fill}
                      stroke={isSel ? "var(--txt2)" : c.stroke}
                      strokeWidth={isSel ? 2.4 : 1.6}
                    />
                    <circle
                      cx={n.x + NW / 2 - 14}
                      cy={n.y - NH / 2 + 14}
                      r="4"
                      fill={c.pip}
                    />
                    <text
                      x={n.x - NW / 2 + 13}
                      y={n.y - 3}
                      fontFamily="var(--sans)"
                      fontSize="12.5"
                      fontWeight="600"
                      fill={c.t1}
                    >
                      {n.label}
                    </text>
                    <text
                      x={n.x - NW / 2 + 13}
                      y={n.y + 13}
                      fontFamily="var(--code)"
                      fontSize="10"
                      fill="var(--dim)"
                    >
                      {n.fn}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        <div className="wf-side">
          <span className="sk">selected task</span>
          <span className="wf-seltype">
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 2,
                background: "currentColor",
                display: "inline-block",
              }}
            />
            {selNode.type}
          </span>
          <div className="wf-selname">
            {selNode.label}
            <span className="mono">{selNode.fn}</span>
          </div>
          <div className="wf-rows">
            <div className="wf-row">
              <span className="k">Status</span>
              <span className="wf-status">
                <span className="sd" style={{ background: selStColor }} />
                {selStatus}
              </span>
            </div>
            <div className="wf-row">
              <span className="k">Depends on</span>
              <div className="wf-depchips">
                {selNode.deps.length ? (
                  selNode.deps.map((d) => (
                    <span key={d} className="dc">
                      {byId[d].label}
                    </span>
                  ))
                ) : (
                  <span className="dc none">none · root task</span>
                )}
              </div>
            </div>
            <div className="wf-row">
              <span className="k">Est. duration</span>
              <span className="v mono">{(selNode.dur / 1000).toFixed(2)}s</span>
            </div>
            <div className="wf-row">
              <span className="k">Downstream tasks</span>
              <span className="v mono">{downstream}</span>
            </div>
          </div>
          <div className="wf-runbranch">
            <button
              type="button"
              className="ctl"
              onClick={() => start(branchSet(selNode.id))}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 3v12" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="6" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              Run from here
            </button>
            <div className="note">
              {downstream > 0
                ? `runs this task + ${downstream} downstream`
                : "runs just this task"}
            </div>
          </div>
        </div>
      </div>

      <div className="legend">
        <span>
          <i style={{ background: "var(--dim)" }} />
          idle
        </span>
        <span>
          <i style={{ background: "var(--indigo-br)" }} />
          queued
        </span>
        <span>
          <i style={{ background: "var(--cyan)" }} />
          running
        </span>
        <span>
          <i style={{ background: "var(--grn)" }} />
          done
        </span>
      </div>

      <div className="readout">
        <div className="stat">
          <span className="k">tasks</span>
          <span className="v">{scope.length}</span>
        </div>
        <div className="stat">
          <span className="k">completed</span>
          <span className="v good">{doneCount}</span>
        </div>
        <div className="stat">
          <span className="k">running</span>
          <span className="v">{runCount}</span>
        </div>
        <div className="stat">
          <span className="k">elapsed</span>
          <span className="v">
            {(sim.elapsed / 1000).toFixed(1)}
            <span className="u">s</span>
          </span>
        </div>
        <div className="stat">
          <span className="k">critical path</span>
          <span className="v">
            {(CRIT / 1000).toFixed(1)}
            <span className="u">s</span>
          </span>
        </div>
      </div>
    </div>
  );
}
