import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRafLoop, useReducedMotion } from "./lib";
import type { DemoProps } from "./types";

/*
 * API rate-limiting demo — requests flow producer → queue → worker pool →
 * external API. Toggle the API to 429 and watch calls fail and retry with
 * exponential backoff. React port of demo-ratelimit.js (SVG + RAF pipeline).
 */

const W = 960;
const H = 300;
const CY = 152;
const NWORK = 5;
const PROC = 1050;
const BACKOFF_BASE = 620;
const MAX_RETRY = 4;
const SPEED = 560;
const SPAWN_MS = 1000;
const QCAP = 12;
const PRO = { x: 90, y: CY };
const QBOX = { x: 286, w: 108, y: CY };
const API = { x: 862, y: CY };
const SLOTS = Array.from({ length: NWORK }, (_, i) => ({
  x: 622,
  y: 86 + i * 38,
}));

type Phase =
  | "toqueue"
  | "queued"
  | "toworker"
  | "processing"
  | "toapi"
  | "success"
  | "backoff"
  | "dead";

interface Token {
  id: number;
  x: number;
  y: number;
  phase: Phase;
  retries: number;
  blocked: boolean;
  tx: number;
  ty: number;
  worker: number | null;
  pUntil: number;
  bUntil: number;
  dead: number;
}
interface Slot {
  x: number;
  y: number;
  busy: Token | null;
}
interface Sim {
  tokens: Token[];
  slots: Slot[];
  metrics: { retries: number; blocked: number; succeeded: number };
  spawnAcc: number;
  last: number;
  idc: number;
}

function freshSim(): Sim {
  return {
    tokens: [],
    slots: SLOTS.map((s) => ({ ...s, busy: null })),
    metrics: { retries: 0, blocked: 0, succeeded: 0 },
    spawnAcc: 0,
    last: 0,
    idc: 0,
  };
}

const COL = {
  queued: "var(--indigo-br)",
  proc: "var(--cyan)",
  success: "var(--grn)",
  block: "var(--red)",
  backoff: "var(--amber)",
};
function colorFor(t: Token): string {
  if (t.phase === "success") return COL.success;
  if (t.phase === "backoff") return COL.backoff;
  if (t.blocked) return COL.block;
  if (t.phase === "processing" || t.phase === "toworker" || t.phase === "toapi")
    return COL.proc;
  return COL.queued;
}
const queuedList = (sim: Sim) => sim.tokens.filter((t) => t.phase === "queued");

export default function RateLimitDemo(_props: DemoProps) {
  const reduced = useReducedMotion();
  const simRef = useRef<Sim>(freshSim());
  const [apiOk, setApiOk] = useState(true);
  const apiOkRef = useRef(true);
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  const spawn = useCallback((n: number) => {
    const sim = simRef.current;
    for (let i = 0; i < n; i++) {
      if (sim.tokens.length > 40) break;
      sim.tokens.push({
        id: ++sim.idc,
        x: PRO.x,
        y: PRO.y + (Math.random() * 20 - 10),
        phase: "toqueue",
        retries: 0,
        blocked: false,
        tx: QBOX.x + 12,
        ty: CY,
        worker: null,
        pUntil: 0,
        bUntil: 0,
        dead: 0,
      });
    }
  }, []);

  const assignWorkers = useCallback((sim: Sim) => {
    const q = queuedList(sim);
    for (const w of sim.slots) {
      if (w.busy == null && q.length) {
        const t = q.shift() as Token;
        w.busy = t;
        t.worker = sim.slots.indexOf(w);
        t.phase = "toworker";
        t.tx = w.x;
        t.ty = w.y;
      }
    }
  }, []);

  const resolveAPI = useCallback((sim: Sim, t: Token, now: number) => {
    const w = t.worker != null ? sim.slots[t.worker] : null;
    if (apiOkRef.current) {
      t.phase = "success";
      t.blocked = false;
      t.tx = W;
      t.ty = CY;
      sim.metrics.succeeded++;
      if (w) w.busy = null;
      t.worker = null;
    } else {
      sim.metrics.blocked++;
      t.retries++;
      t.blocked = true;
      if (w) w.busy = null;
      t.worker = null;
      if (t.retries > MAX_RETRY) {
        t.phase = "dead";
        t.dead = now;
      } else {
        sim.metrics.retries++;
        t.phase = "backoff";
        t.bUntil = now + BACKOFF_BASE * 2 ** (t.retries - 1);
        t.tx = QBOX.x + QBOX.w / 2;
        t.ty = CY + 58;
      }
    }
  }, []);

  const step = useCallback(
    (now: number, dt: number) => {
      const sim = simRef.current;
      if (!reduced) {
        sim.spawnAcc += dt;
        if (sim.spawnAcc > SPAWN_MS) {
          sim.spawnAcc = 0;
          if (queuedList(sim).length < 22) spawn(1);
        }
      }
      assignWorkers(sim);
      queuedList(sim).forEach((t, i) => {
        t.tx = 300 + (i % 3) * 34;
        t.ty = 120 + Math.floor(i / 3) * 30;
      });
      const move = (SPEED * dt) / 1000;
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
        const arrived = d < 3;
        switch (t.phase) {
          case "toqueue":
            if (arrived) {
              t.phase = "queued";
              t.blocked = false;
            }
            break;
          case "toworker":
            if (arrived) {
              t.phase = "processing";
              t.pUntil = now + PROC * (0.8 + Math.random() * 0.5);
            }
            break;
          case "processing":
            if (now >= t.pUntil) {
              t.phase = "toapi";
              t.tx = API.x - 26;
              t.ty = CY;
            }
            break;
          case "toapi":
            if (arrived) resolveAPI(sim, t, now);
            break;
          case "backoff":
            if (now >= t.bUntil) {
              t.phase = "toqueue";
              t.tx = QBOX.x + 12;
              t.ty = CY;
            }
            break;
          case "success":
            if (t.x >= W - 1) sim.tokens.splice(i, 1);
            break;
          case "dead":
            if (now - t.dead > 900) sim.tokens.splice(i, 1);
            break;
        }
      }
      repaint();
    },
    [reduced, spawn, assignWorkers, resolveAPI],
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when motion preference flips; spawn/assignWorkers stable
  useEffect(() => {
    const sim = freshSim();
    simRef.current = sim;
    if (reduced) {
      // static seed: some queued, fill workers
      for (let i = 0; i < 9; i++) {
        sim.tokens.push({
          id: ++sim.idc,
          x: 300 + (i % 3) * 34,
          y: 120 + Math.floor(i / 3) * 30,
          phase: "queued",
          retries: 0,
          blocked: false,
          tx: 0,
          ty: 0,
          worker: null,
          pUntil: 0,
          bUntil: 0,
          dead: 0,
        });
      }
      assignWorkers(sim);
      for (const t of sim.tokens) {
        if (t.worker != null) {
          t.phase = "processing";
          t.x = sim.slots[t.worker].x;
          t.y = sim.slots[t.worker].y;
        }
      }
    } else {
      spawn(4);
    }
    repaint();
  }, [reduced]);

  useRafLoop(tick, !reduced);

  const toggleApi = (ok: boolean) => {
    apiOkRef.current = ok;
    setApiOk(ok);
    repaint();
  };

  const sim = simRef.current;
  const ql = queuedList(sim);
  const qd = ql.length;
  const inflight = sim.tokens.filter(
    (t) =>
      t.phase === "toworker" || t.phase === "processing" || t.phase === "toapi",
  ).length;
  const backoff = sim.tokens.filter((t) => t.phase === "backoff").length;
  let maxBo = 0;
  for (const t of sim.tokens) {
    if (t.phase === "backoff") {
      const s = (t.bUntil - performance.now()) / 1000;
      if (s > maxBo) maxBo = s;
    }
  }
  const ovf = qd - QCAP;
  const retryLane = backoff > 0 || !apiOk;

  return (
    <div className="dm-frame-react">
      <div className="demo-bar">
        <span className="title">
          <span className="ld" />
          rate-limit · live
        </span>
        <div className="demo-controls">
          <button type="button" className="ctl pri" onClick={() => spawn(8)}>
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
            Send burst (8)
          </button>
          {/* biome-ignore lint/a11y/useSemanticElements: segmented toggle of aria-pressed buttons; a fieldset/legend would fight the inline-flex .seg styling */}
          <div className="seg" role="group" aria-label="External API status">
            {(
              [
                { ok: true, cls: "good", label: "API: 200 OK" },
                { ok: false, cls: "bad", label: "API: 429" },
              ] as const
            ).map((opt) => (
              <button
                type="button"
                key={opt.label}
                className={opt.cls}
                data-on={apiOk === opt.ok ? "1" : "0"}
                aria-pressed={apiOk === opt.ok}
                onClick={() => toggleApi(opt.ok)}
              >
                <span className="dot" />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="stage">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Animated pipeline: requests move from your code into a queue, are picked up by a pool of workers, and call an external API. When the API returns 429, calls fail and retry with exponential backoff."
        >
          <defs>
            <marker
              id="rl-ar"
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

          {/* guide wires */}
          {["M150 152 H286", "M394 152 H560", "M690 152 H800"].map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke="var(--line2)"
              strokeWidth="2"
              strokeDasharray="2 7"
              strokeLinecap="round"
              markerEnd="url(#rl-ar)"
            />
          ))}
          <path
            d="M862 196 C 862 270, 340 286, 300 244"
            fill="none"
            stroke="color-mix(in oklch,var(--red) 45%,transparent)"
            strokeWidth="2"
            strokeDasharray="2 7"
            strokeLinecap="round"
            opacity={retryLane ? 0.7 : 0}
          />
          <text
            x="560"
            y="284"
            textAnchor="middle"
            fontFamily="var(--mono)"
            fontSize="11"
            fill="var(--red)"
            opacity={retryLane ? 0.9 : 0}
          >
            retry · exponential backoff
          </text>

          {/* producer */}
          <g>
            <rect
              x="30"
              y="120"
              width="120"
              height="64"
              rx="13"
              fill="var(--panel3)"
              stroke="var(--line2)"
            />
            <text
              x="90"
              y="146"
              textAnchor="middle"
              fontFamily="var(--mono)"
              fontSize="11"
              fill="var(--mut)"
            >
              your code
            </text>
            <text
              x="90"
              y="165"
              textAnchor="middle"
              fontFamily="var(--code)"
              fontSize="12"
              fontWeight="600"
              fill="var(--txt2)"
            >
              .delay()
            </text>
          </g>

          {/* queue */}
          <g>
            <rect
              x="280"
              y="86"
              width="120"
              height="132"
              rx="13"
              fill="var(--panel)"
              stroke="var(--line2)"
            />
            <text
              x="340"
              y="106"
              textAnchor="middle"
              fontFamily="var(--mono)"
              fontSize="11"
              fill="var(--mut)"
            >
              QUEUE
            </text>
            <text
              x="340"
              y="240"
              textAnchor="middle"
              fontFamily="var(--code)"
              fontSize="11"
              fill="var(--dim)"
            >
              {ovf > 0 ? `+${ovf} more` : ""}
            </text>
          </g>

          {/* worker pool */}
          <g>
            <rect
              x="560"
              y="64"
              width="124"
              height="176"
              rx="13"
              fill="none"
              stroke="var(--line2)"
              strokeDasharray="3 6"
            />
            <text
              x="622"
              y="58"
              textAnchor="middle"
              fontFamily="var(--mono)"
              fontSize="11"
              fill="var(--mut)"
            >
              WORKERS · {NWORK}
            </text>
          </g>
          {sim.slots.map((w, i) => {
            const busy = w.busy != null;
            return (
              <rect
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed worker slot list
                key={`ws${i}`}
                x={w.x - 22}
                y={w.y - 15}
                width="44"
                height="30"
                rx="8"
                fill={
                  busy
                    ? apiOk
                      ? "color-mix(in oklch,var(--cyan) 18%,transparent)"
                      : "color-mix(in oklch,var(--red) 16%,transparent)"
                    : "var(--panel2)"
                }
                stroke={
                  busy
                    ? apiOk
                      ? "color-mix(in oklch,var(--cyan) 45%,transparent)"
                      : "color-mix(in oklch,var(--red) 45%,transparent)"
                    : "var(--line2)"
                }
              />
            );
          })}

          {/* API */}
          <g>
            <rect
              x="800"
              y="110"
              width="128"
              height="84"
              rx="13"
              fill="var(--panel3)"
              stroke={
                apiOk
                  ? "var(--line2)"
                  : "color-mix(in oklch,var(--red) 40%,transparent)"
              }
            />
            <text
              x="864"
              y="138"
              textAnchor="middle"
              fontFamily="var(--mono)"
              fontSize="11"
              fill="var(--mut)"
            >
              external API
            </text>
            <g transform="translate(864,162)">
              <rect
                x="-34"
                y="-13"
                width="68"
                height="26"
                rx="13"
                fill={
                  apiOk
                    ? "color-mix(in oklch,var(--grn) 16%,transparent)"
                    : "color-mix(in oklch,var(--red) 18%,transparent)"
                }
                stroke={
                  apiOk
                    ? "color-mix(in oklch,var(--grn) 40%,transparent)"
                    : "color-mix(in oklch,var(--red) 48%,transparent)"
                }
              />
              <text
                x="0"
                y="5"
                textAnchor="middle"
                fontFamily="var(--code)"
                fontSize="12"
                fontWeight="700"
                fill={apiOk ? "var(--grn)" : "var(--red)"}
              >
                {apiOk ? "200" : "429"}
              </text>
            </g>
          </g>

          {/* tokens */}
          <g>
            {sim.tokens.map((t) => {
              let opacity = 1;
              if (t.phase === "dead") opacity = 0.25;
              else if (t.phase === "backoff") opacity = 0.85;
              else if (t.phase === "success")
                opacity = Math.max(0, 1 - (t.x - API.x) / (W - API.x));
              return (
                <circle
                  key={t.id}
                  cx={t.x.toFixed(1)}
                  cy={t.y.toFixed(1)}
                  r={t.phase === "processing" ? 6.5 : 6}
                  fill={colorFor(t)}
                  opacity={opacity}
                />
              );
            })}
          </g>
        </svg>
      </div>

      <div className="legend">
        <span>
          <i style={{ background: "var(--indigo-br)" }} />
          queued
        </span>
        <span>
          <i style={{ background: "var(--cyan)" }} />
          processing
        </span>
        <span>
          <i style={{ background: "var(--grn)" }} />
          succeeded
        </span>
        <span>
          <i style={{ background: "var(--red)" }} />
          429 · retrying
        </span>
        <span>
          <i style={{ background: "var(--amber)" }} />
          backoff wait
        </span>
      </div>

      <div className="readout">
        <div className="stat">
          <span className="k">queue depth</span>
          <span className="v">{qd}</span>
        </div>
        <div className="stat">
          <span className="k">in flight</span>
          <span className="v">{inflight}</span>
        </div>
        <div className="stat">
          <span className="k">retries</span>
          <span className="v">{sim.metrics.retries}</span>
        </div>
        <div className="stat">
          <span className="k">429 blocked</span>
          <span className="v bad">{sim.metrics.blocked}</span>
        </div>
        <div className="stat">
          <span className="k">succeeded</span>
          <span className="v good">{sim.metrics.succeeded}</span>
        </div>
        <div className="stat">
          <span className="k">backoff</span>
          <span className={`v ${maxBo > 0 ? "warn" : ""}`}>
            {maxBo > 0 ? maxBo.toFixed(1) : "0"}
            <span className="u">s</span>
          </span>
        </div>
      </div>
    </div>
  );
}
