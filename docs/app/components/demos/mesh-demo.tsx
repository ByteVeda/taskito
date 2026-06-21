import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useRafLoop, useReducedMotion } from "./lib";
import type { DemoProps } from "./types";

/*
 * Mesh scheduling demo — jobs carry a routing key; the brokerless mesh sends
 * each to a worker pool built to run it (gpu / default / email). Click a machine
 * to drop it and watch its work reroute across the pool. React port of the
 * vendored demo-mesh.js (SVG + RAF token simulation).
 */

const W = 940;
const H = 330;
const DISP = { x: 92, y: 165 };
const EX = 430; // pool entry x
const SPEED = 560;
const NX0 = 560;
const NSTEP = 128;
const NW = 104;
const NH = 46;
const WEIGHT = { gpu: 0.24, default: 0.52, email: 0.24 };
const MAX_TOKENS = 34;

interface PoolDef {
  key: "gpu" | "default" | "email";
  label: string;
  col: string;
  y: number;
  n: number;
  dur: number;
}
const POOL_DEFS: PoolDef[] = [
  {
    key: "gpu",
    label: "gpu · render",
    col: "var(--cyan)",
    y: 60,
    n: 2,
    dur: 1650,
  },
  {
    key: "default",
    label: "default · web",
    col: "var(--indigo-br)",
    y: 165,
    n: 3,
    dur: 900,
  },
  {
    key: "email",
    label: "email · notify",
    col: "var(--amber)",
    y: 270,
    n: 2,
    dur: 720,
  },
];

type Phase = "toentry" | "tonode" | "processing" | "waiting" | "done";

interface NodeState {
  x: number;
  y: number;
  busy: Token | null;
  off: boolean;
  key: string;
  idx: number;
  pool: Pool;
}
interface Token {
  id: number;
  pool: Pool;
  x: number;
  y: number;
  phase: Phase;
  tx: number;
  ty: number;
  pUntil: number;
  node: NodeState | null;
}
interface Pool extends PoolDef {
  nodes: NodeState[];
  wait: Token[];
}
interface Sim {
  pools: Pool[];
  tokens: Token[];
  metrics: { routed: number; rerouted: number };
  emitAcc: number;
  last: number;
  ids: number;
}

/** First online, idle node in a pool, or null when none is free. */
function freeNode(p: Pool): NodeState | null {
  return p.nodes.find((nd) => !nd.off && !nd.busy) ?? null;
}

function freshSim(): Sim {
  const pools: Pool[] = POOL_DEFS.map((d) => ({ ...d, nodes: [], wait: [] }));
  for (const p of pools) {
    for (let i = 0; i < p.n; i++) {
      p.nodes.push({
        x: NX0 + i * NSTEP,
        y: p.y,
        busy: null,
        off: false,
        key: p.key,
        idx: i,
        pool: p,
      });
    }
  }
  return {
    pools,
    tokens: [],
    metrics: { routed: 0, rerouted: 0 },
    emitAcc: 0,
    last: 0,
    ids: 0,
  };
}

export default function MeshDemo(_props: DemoProps) {
  const reduced = useReducedMotion();
  const simRef = useRef<Sim>(freshSim());
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  const poolByKey = useCallback(
    (k: string) => simRef.current.pools.find((p) => p.key === k) as Pool,
    [],
  );

  const pickKey = useCallback((): PoolDef["key"] => {
    const r = Math.random();
    if (r < WEIGHT.gpu) return "gpu";
    if (r < WEIGHT.gpu + WEIGHT.default) return "default";
    return "email";
  }, []);

  const emit = useCallback(
    (n: number) => {
      const sim = simRef.current;
      for (let i = 0; i < n; i++) {
        if (sim.tokens.length >= MAX_TOKENS) break;
        const p = poolByKey(pickKey());
        sim.tokens.push({
          id: sim.ids++,
          pool: p,
          x: DISP.x + 22,
          y: DISP.y + (Math.random() * 16 - 8),
          phase: "toentry",
          tx: EX,
          ty: p.y,
          pUntil: 0,
          node: null,
        });
      }
    },
    [poolByKey, pickKey],
  );

  const assignPool = useCallback((p: Pool) => {
    let nd = freeNode(p);
    while (p.wait.length && nd) {
      const t = p.wait.shift() as Token;
      nd.busy = t;
      t.node = nd;
      t.phase = "tonode";
      t.tx = nd.x;
      t.ty = nd.y;
      nd = freeNode(p);
    }
  }, []);

  const arriveEntry = useCallback((t: Token) => {
    const nd = freeNode(t.pool);
    if (nd) {
      nd.busy = t;
      t.node = nd;
      t.phase = "tonode";
      t.tx = nd.x;
      t.ty = nd.y;
    } else {
      const idx = t.pool.wait.length;
      t.phase = "waiting";
      t.pool.wait.push(t);
      t.tx = 445;
      t.ty = t.pool.y - 20 + idx * 13;
    }
  }, []);

  const step = useCallback(
    (now: number, dt: number) => {
      const sim = simRef.current;
      if (!reduced) {
        sim.emitAcc += dt;
        if (sim.emitAcc > 880) {
          sim.emitAcc = 0;
          if (sim.tokens.length < 26) emit(1);
        }
      }
      const move = (SPEED * dt) / 1000;
      for (const p of sim.pools) {
        p.wait.forEach((t, i) => {
          t.tx = 445;
          t.ty = p.y - 20 + i * 13;
        });
        assignPool(p);
      }
      for (let i = sim.tokens.length - 1; i >= 0; i--) {
        const t = sim.tokens[i];
        const dx = t.tx - t.x;
        const dy = t.ty - t.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.5) {
          const s = Math.min(move, d);
          t.x += (dx / d) * s;
          t.y += (dy / d) * s;
        }
        const arrived = d < 2.5;
        switch (t.phase) {
          case "toentry":
            if (arrived) arriveEntry(t);
            break;
          case "tonode":
            if (arrived) {
              t.phase = "processing";
              t.pUntil = now + t.pool.dur * (0.82 + Math.random() * 0.4);
            }
            break;
          case "processing":
            if (now >= t.pUntil) {
              if (t.node) {
                t.node.busy = null;
                assignPool(t.pool);
              }
              sim.metrics.routed++;
              t.phase = "done";
              t.tx = W + 30;
              t.ty = t.y;
            }
            break;
          case "done":
            if (t.x > W + 20) sim.tokens.splice(i, 1);
            break;
        }
      }
      repaint();
    },
    [reduced, emit, assignPool, arriveEntry],
  );

  const toggleNode = useCallback(
    (nd: NodeState) => {
      nd.off = !nd.off;
      if (nd.off && nd.busy) {
        const t = nd.busy;
        nd.busy = null;
        simRef.current.metrics.rerouted++;
        t.node = null;
        t.phase = "waiting";
        nd.pool.wait.unshift(t);
        t.tx = 445;
        t.ty = nd.pool.y - 20;
      }
      if (!nd.off) assignPool(nd.pool);
      repaint();
    },
    [assignPool],
  );

  const tick = useCallback(
    (now: number) => {
      const sim = simRef.current;
      if (!sim.last) sim.last = now;
      const dt = Math.min(now - sim.last, 60);
      sim.last = now;
      step(now, dt);
    },
    [step],
  );

  // Seed on mount: a few in-flight tokens (live) or a static frame (reduced).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when motion preference flips; emit/arriveEntry are stable.
  useEffect(() => {
    simRef.current = freshSim();
    if (reduced) {
      emit(7);
      for (const t of simRef.current.tokens) {
        t.x = EX;
        t.y = t.pool.y;
        arriveEntry(t);
      }
    } else {
      emit(3);
    }
    repaint();
  }, [reduced]);

  useRafLoop(tick, !reduced);

  const sim = simRef.current;

  // Static wires (dispatcher → entry curves + entry → node lines).
  const wires = useMemo(() => {
    const mx = (148 + EX) / 2;
    const out: { d: string; arrow: boolean }[] = [];
    for (const p of POOL_DEFS) {
      out.push({
        d: `M148 165 C ${mx} 165, ${mx} ${p.y}, ${EX} ${p.y}`,
        arrow: true,
      });
      for (let i = 0; i < p.n; i++) {
        out.push({
          d: `M420 ${p.y} H ${NX0 + i * NSTEP - NW / 2}`,
          arrow: false,
        });
      }
    }
    return out;
  }, []);

  // Readout.
  let online = 0;
  let total = 0;
  let busy = 0;
  let waiting = 0;
  for (const p of sim.pools) {
    for (const nd of p.nodes) {
      total++;
      if (!nd.off) online++;
      if (nd.busy) busy++;
    }
    waiting += p.wait.length;
  }
  const flight = sim.tokens.filter(
    (t) => t.phase === "toentry" || t.phase === "tonode",
  ).length;

  return (
    <div className="dm-frame-react">
      <div className="demo-bar">
        <span className="title">
          <span className="ld" />
          worker-mesh · live
        </span>
        <div className="demo-controls">
          <span className="mesh-hint">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 17v.01M12 13.5a2 2 0 0 0 .914-3.782 1.98 1.98 0 0 0-2.414.483" />
              <circle cx="12" cy="12" r="9" />
            </svg>
            click a machine to drop it
          </span>
          <button type="button" className="ctl pri" onClick={() => emit(6)}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
            </svg>
            Send burst (6)
          </button>
        </div>
      </div>

      <div className="stage">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Mesh scheduling: jobs leave a dispatcher and route by key to one of three worker pools — gpu, default, and email. Click a worker to take it offline and its jobs reroute to the rest of its pool."
        >
          <defs>
            <marker
              id="mesh-ar"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path
                d="M1 1 L9 5 L1 9"
                fill="none"
                stroke="var(--line3)"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>
          </defs>

          <g>
            {wires.map((wire) => (
              <path
                key={wire.d}
                d={wire.d}
                fill="none"
                stroke="var(--line2)"
                strokeWidth="2"
                strokeDasharray="2 7"
                strokeLinecap="round"
                markerEnd={wire.arrow ? "url(#mesh-ar)" : undefined}
              />
            ))}
          </g>

          {/* dispatcher */}
          <g>
            <rect
              x="36"
              y="133"
              width="112"
              height="64"
              rx="13"
              fill="var(--panel3)"
              stroke="var(--line2)"
            />
            <text
              x="92"
              y="159"
              textAnchor="middle"
              fontFamily="var(--mono)"
              fontSize="11"
              fill="var(--mut)"
            >
              dispatcher
            </text>
            <text
              x="92"
              y="178"
              textAnchor="middle"
              fontFamily="var(--code)"
              fontSize="11"
              fontWeight="600"
              fill="var(--txt2)"
            >
              route()
            </text>
          </g>

          {/* pool chips + nodes */}
          <g>
            {sim.pools.map((p) => (
              <g key={p.key}>
                <rect
                  x="300"
                  y={p.y - 15}
                  width="120"
                  height="30"
                  rx="9"
                  fill="var(--panel)"
                  stroke={p.col}
                />
                <rect
                  x="300"
                  y={p.y - 15}
                  width="120"
                  height="30"
                  rx="9"
                  fill="none"
                  stroke={`color-mix(in oklch,${p.col} 40%,transparent)`}
                />
                <circle cx="316" cy={p.y} r="4" fill={p.col} />
                <text
                  x="328"
                  y={p.y + 4}
                  fontFamily="var(--mono)"
                  fontSize="11"
                  fill="var(--txt2)"
                >
                  {p.label}
                </text>
                {p.nodes.map((nd) => {
                  const fill = nd.off
                    ? "var(--panel)"
                    : nd.busy
                      ? `color-mix(in oklch,${p.col} 16%,transparent)`
                      : "var(--panel2)";
                  const stroke = nd.off
                    ? "var(--line2)"
                    : nd.busy
                      ? `color-mix(in oklch,${p.col} 50%,transparent)`
                      : "var(--line2)";
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: SVG <g> can't be an HTML <button>; role+key handlers give it button semantics
                    <g
                      key={`${p.key}-${nd.idx}`}
                      className="mesh-node"
                      tabIndex={0}
                      role="button"
                      aria-pressed={nd.off}
                      aria-label={`${p.key} worker — ${nd.off ? "offline, click to bring online" : "online, click to take offline"}`}
                      style={{ opacity: nd.off ? 0.55 : 1 }}
                      onClick={() => toggleNode(nd)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleNode(nd);
                        }
                      }}
                    >
                      <rect
                        x={nd.x - NW / 2}
                        y={nd.y - NH / 2}
                        width={NW}
                        height={NH}
                        rx="11"
                        fill={fill}
                        stroke={stroke}
                        strokeDasharray={nd.off ? "3 5" : undefined}
                      />
                      <circle
                        cx={nd.x + NW / 2 - 13}
                        cy={nd.y - NH / 2 + 13}
                        r="4"
                        fill={!nd.off && nd.busy ? "var(--grn)" : "var(--dim)"}
                      />
                      <text
                        x={nd.x - NW / 2 + 12}
                        y={nd.y + 4}
                        fontFamily="var(--code)"
                        fontSize="11"
                        fontWeight="600"
                        fill="var(--txt2)"
                      >
                        {p.key}-{nd.idx + 1}
                      </text>
                      <path
                        d={`M${nd.x - 9} ${nd.y - 9} l18 18 M${nd.x + 9} ${nd.y - 9} l-18 18`}
                        stroke="var(--red)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        opacity={nd.off ? 0.8 : 0}
                      />
                    </g>
                  );
                })}
              </g>
            ))}
          </g>

          {/* tokens */}
          <g>
            {sim.tokens.map((t) => (
              <circle
                key={t.id}
                cx={t.x.toFixed(1)}
                cy={t.y.toFixed(1)}
                r={t.phase === "processing" ? 6.5 : 6}
                fill={t.pool.col}
                opacity={t.phase === "waiting" ? 0.8 : 1}
              />
            ))}
          </g>
        </svg>
      </div>

      <div className="legend">
        <span>
          <i style={{ background: "var(--cyan)" }} />
          gpu job
        </span>
        <span>
          <i style={{ background: "var(--indigo-br)" }} />
          default job
        </span>
        <span>
          <i style={{ background: "var(--amber)" }} />
          email job
        </span>
        <span>
          <i style={{ background: "var(--grn)" }} />
          worker busy
        </span>
        <span>
          <i style={{ background: "var(--dim)" }} />
          offline
        </span>
      </div>

      <div className="readout">
        <div className="stat">
          <span className="k">nodes online</span>
          <span className="v">
            {online} / {total}
          </span>
        </div>
        <div className="stat">
          <span className="k">routing</span>
          <span className="v">{flight + busy}</span>
        </div>
        <div className="stat">
          <span className="k">waiting</span>
          <span className={`v ${waiting > 0 ? "warn" : ""}`}>{waiting}</span>
        </div>
        <div className="stat">
          <span className="k">routed</span>
          <span className="v good">{sim.metrics.routed}</span>
        </div>
        <div className="stat">
          <span className="k">rerouted</span>
          <span className={`v ${sim.metrics.rerouted > 0 ? "bad" : ""}`}>
            {sim.metrics.rerouted}
          </span>
        </div>
      </div>
    </div>
  );
}
