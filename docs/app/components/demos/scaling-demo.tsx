import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRafLoop, useReducedMotion } from "./lib";
import type { DemoProps } from "./types";

/*
 * Worker-scaling playground — sliders drive a stochastic M/M/c queue simulation;
 * throughput, queue-depth and latency charts respond live on Canvas 2D. React
 * port of demo-playground.js (Canvas + RAF).
 */

interface Params {
  workers: number;
  conc: number;
  lambda: number;
  jobMs: number;
  rate: number;
}
const DEFAULTS: Params = {
  workers: 4,
  conc: 2,
  lambda: 18,
  jobMs: 300,
  rate: 0,
};

interface Field {
  k: keyof Params;
  n: string;
  sub: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}
const FIELDS: Field[] = [
  {
    k: "workers",
    n: "Workers",
    sub: "pool size",
    min: 1,
    max: 12,
    step: 1,
    fmt: (v) => `${v}`,
  },
  {
    k: "conc",
    n: "Concurrency",
    sub: "per worker",
    min: 1,
    max: 8,
    step: 1,
    fmt: (v) => `×${v}`,
  },
  {
    k: "lambda",
    n: "Arrival rate",
    sub: "jobs / s",
    min: 1,
    max: 80,
    step: 1,
    fmt: (v) => `${v}/s`,
  },
  {
    k: "jobMs",
    n: "Avg job time",
    sub: "milliseconds",
    min: 50,
    max: 1200,
    step: 25,
    fmt: (v) => `${v}ms`,
  },
  {
    k: "rate",
    n: "Rate limit",
    sub: "0 = unlimited",
    min: 0,
    max: 60,
    step: 2,
    fmt: (v) => (v === 0 ? "off" : `${v}/s`),
  },
];

const BUF = 170;

interface Sim {
  N: number;
  tokens: number;
  thrEMA: number;
  latEMA: number;
  hThr: number[];
  hQ: number[];
  hLat: number[];
}
function freshSim(rate: number): Sim {
  return {
    N: 0,
    tokens: rate,
    thrEMA: 0,
    latEMA: 0,
    hThr: new Array(BUF).fill(0),
    hQ: new Array(BUF).fill(0),
    hLat: new Array(BUF).fill(0),
  };
}

function gauss(): number {
  const u = Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u || 1e-9)) * Math.cos(6.283185 * v);
}
function poisson(mean: number): number {
  if (mean <= 0) return 0;
  if (mean > 30)
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss()));
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function resolveColor(varExpr: string): string {
  const s = document.createElement("span");
  s.style.cssText = "position:absolute;opacity:0;pointer-events:none";
  s.style.color = varExpr;
  document.body.appendChild(s);
  const c = getComputedStyle(s).color;
  s.remove();
  return c;
}
function withAlpha(rgb: string, a: number): string {
  const m = rgb.match(/\d+/g);
  if (!m) return rgb;
  return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
}

interface CanvasBox {
  el: HTMLCanvasElement;
  w: number;
  h: number;
}
const boxOf = (el: HTMLCanvasElement | null): CanvasBox | null =>
  el ? { el, w: el.clientWidth, h: el.clientHeight || 84 } : null;
function sizeCanvas(box: CanvasBox) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = box.el.clientWidth;
  const h = box.el.clientHeight || 84;
  box.w = w;
  box.h = h;
  box.el.width = w * dpr;
  box.el.height = h * dpr;
  box.el.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function drawChart(
  box: CanvasBox,
  data: number[],
  color: string,
  grid: string,
  yMaxFloor: number,
) {
  const ctx = box.el.getContext("2d");
  if (!ctx) return;
  const { w, h } = box;
  ctx.clearRect(0, 0, w, h);
  const pad = 6;
  const gh = h - pad * 2;
  let max = yMaxFloor;
  for (const d of data) if (d > max) max = d;
  max = max * 1.18 + 0.001;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - pad);
  ctx.lineTo(w, h - pad);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, pad);
  ctx.lineTo(w, pad);
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  const n = data.length;
  const dx = w / (n - 1);
  const X = (i: number) => i * dx;
  const Y = (v: number) => pad + gh - (Math.min(v, max) / max) * gh;
  ctx.beginPath();
  ctx.moveTo(0, h - pad);
  for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(data[i]));
  ctx.lineTo(w, h - pad);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad, 0, h);
  grad.addColorStop(0, withAlpha(color, 0.3));
  grad.addColorStop(1, withAlpha(color, 0.02));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = X(i);
    const y = Y(data[i]);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();
  const hx = X(n - 1);
  const hy = Y(data[n - 1]);
  ctx.beginPath();
  ctx.arc(hx, hy, 3, 0, 6.2832);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx, hy, 5.5, 0, 6.2832);
  ctx.strokeStyle = withAlpha(color, 0.4);
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export default function ScalingDemo({ theme }: DemoProps) {
  const reduced = useReducedMotion();
  const [params, setParams] = useState<Params>(DEFAULTS);
  const paramsRef = useRef<Params>(DEFAULTS);
  paramsRef.current = params;
  const simRef = useRef<Sim>(freshSim(DEFAULTS.rate));
  const thrRef = useRef<HTMLCanvasElement>(null);
  const qRef = useRef<HTMLCanvasElement>(null);
  const latRef = useRef<HTMLCanvasElement>(null);
  const colorsRef = useRef({ thr: "", q: "", lat: "", grid: "" });
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  const stepSim = useCallback((dt: number) => {
    const P = paramsRef.current;
    const sim = simRef.current;
    const C = P.workers * P.conc;
    sim.N += poisson(P.lambda * dt);
    const inService = Math.min(sim.N, C);
    const rl = P.rate > 0;
    if (rl) sim.tokens = Math.min(P.rate, sim.tokens + P.rate * dt);
    const svcMean = (inService * dt) / (P.jobMs / 1000);
    let done = Math.min(poisson(svcMean), sim.N);
    if (rl) {
      done = Math.min(done, Math.floor(sim.tokens));
      sim.tokens -= done;
    }
    sim.N -= done;
    const inst = dt > 0 ? done / dt : 0;
    sim.thrEMA += (inst - sim.thrEMA) * Math.min(1, dt * 3.2);
    const q = Math.max(0, sim.N - C);
    const lat =
      sim.thrEMA > 0.2 ? (sim.N / sim.thrEMA) * 1000 : sim.N > 0 ? 9000 : 0;
    sim.latEMA += (lat - sim.latEMA) * Math.min(1, dt * 2.2);
    sim.hThr.push(sim.thrEMA);
    sim.hThr.shift();
    sim.hQ.push(q);
    sim.hQ.shift();
    sim.hLat.push(sim.latEMA);
    sim.hLat.shift();
  }, []);

  const drawAll = useCallback(() => {
    const c = colorsRef.current;
    const sim = simRef.current;
    const thr = boxOf(thrRef.current);
    const q = boxOf(qRef.current);
    const lat = boxOf(latRef.current);
    if (thr) drawChart(thr, sim.hThr, c.thr, c.grid, 8);
    if (q) drawChart(q, sim.hQ, c.q, c.grid, 6);
    if (lat) drawChart(lat, sim.hLat, c.lat, c.grid, 400);
    repaint();
  }, []);

  const refreshColors = useCallback(() => {
    colorsRef.current = {
      thr: resolveColor("var(--indigo-br)"),
      q: resolveColor("var(--amber)"),
      lat: resolveColor("var(--cyan)"),
      grid: resolveColor("var(--line)"),
    };
  }, []);

  const sizeAll = useCallback(() => {
    for (const el of [thrRef.current, qRef.current, latRef.current]) {
      const box = boxOf(el);
      if (box) sizeCanvas(box);
    }
  }, []);

  const loop = useCallback(() => {
    const sub = 2;
    for (let i = 0; i < sub; i++) stepSim((0.05 / sub) * 1.6);
    drawAll();
  }, [stepSim, drawAll]);

  const staticEval = useCallback(() => {
    simRef.current = freshSim(paramsRef.current.rate);
    for (let i = 0; i < 260; i++) stepSim(0.1);
    refreshColors();
    sizeAll();
    drawAll();
  }, [stepSim, refreshColors, sizeAll, drawAll]);

  // Mount + motion-preference changes: size canvases, seed, draw.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only on motion preference; helper callbacks are stable
  useEffect(() => {
    refreshColors();
    sizeAll();
    if (reduced) staticEval();
    else simRef.current = freshSim(paramsRef.current.rate);
    drawAll();
  }, [reduced]);

  // Re-resolve chart colors + redraw when the host theme flips.
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw on theme change
  useEffect(() => {
    refreshColors();
    drawAll();
  }, [theme]);

  // Keep canvases sized to their container.
  useEffect(() => {
    const onResize = () => {
      sizeAll();
      drawAll();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [sizeAll, drawAll]);

  useRafLoop(loop, !reduced);

  const onSlide = (k: keyof Params, v: number) => {
    setParams((prev) => ({ ...prev, [k]: v }));
    if (reduced) {
      // staticEval reads paramsRef which updates next render; schedule after state flush
      requestAnimationFrame(staticEval);
    }
  };
  const reset = () => {
    setParams(DEFAULTS);
    paramsRef.current = DEFAULTS;
    simRef.current = freshSim(DEFAULTS.rate);
    if (reduced) requestAnimationFrame(staticEval);
    else drawAll();
  };

  const sim = simRef.current;
  const C = params.workers * params.conc;
  const svcCap = C / (params.jobMs / 1000);
  const cap = params.rate > 0 ? Math.min(svcCap, params.rate) : svcCap;
  let verdict = "Overloaded — queue is growing.";
  let vcls = "bad";
  if (cap >= params.lambda * 1.12) {
    verdict = "Keeping up — pool has headroom.";
    vcls = "good";
  } else if (cap >= params.lambda * 0.97) {
    verdict = "Saturated — running near capacity.";
    vcls = "warn";
  }

  return (
    <div className="dm-frame-react">
      <div className="demo-bar">
        <span className="title">
          <span className="ld" />
          worker-pool · simulation
        </span>
        <div className="demo-controls">
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

      <div className="wp-grid">
        <div className="wp-ctl">
          {FIELDS.map((f) => (
            <div className="wp-field" key={f.k}>
              <div className="lab">
                <span className="n">
                  {f.n} <small>{f.sub}</small>
                </span>
                <span className="val">{f.fmt(params[f.k])}</span>
              </div>
              <input
                type="range"
                className="wp-range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={params[f.k]}
                aria-label={f.n}
                onChange={(e) => onSlide(f.k, +e.target.value)}
              />
            </div>
          ))}
          <div className="wp-cap">
            <b>{C}</b> in-flight slots · capacity <b>≈{cap.toFixed(0)}/s</b> vs
            demand <b>{params.lambda}/s</b>
            {params.rate > 0 ? ` · capped at ${params.rate}/s` : ""}
            <span className={`verdict ${vcls}`}>{verdict}</span>
          </div>
        </div>
        <div className="wp-charts">
          <div className="wp-chart">
            <div className="ch-hd">
              <span className="t">
                <i style={{ background: "var(--indigo-br)" }} />
                Throughput
              </span>
              <span className="now">
                {sim.hThr[BUF - 1].toFixed(1)}
                <span className="u">/s</span>
              </span>
            </div>
            <canvas className="wp-canvas" ref={thrRef} />
          </div>
          <div className="wp-chart">
            <div className="ch-hd">
              <span className="t">
                <i style={{ background: "var(--amber)" }} />
                Queue depth
              </span>
              <span className="now">
                {Math.round(sim.hQ[BUF - 1])}
                <span className="u">jobs</span>
              </span>
            </div>
            <canvas className="wp-canvas" ref={qRef} />
          </div>
          <div className="wp-chart">
            <div className="ch-hd">
              <span className="t">
                <i style={{ background: "var(--cyan)" }} />
                Latency (p50)
              </span>
              <span className="now">
                {Math.round(sim.hLat[BUF - 1])}
                <span className="u">ms</span>
              </span>
            </div>
            <canvas className="wp-canvas" ref={latRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
