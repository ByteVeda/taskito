import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRafLoop, useReducedMotion } from "./lib";
import type { DemoProps } from "./types";

/*
 * Failure-recovery demo — a scrubbable timeline of one job's lifecycle. Drag the
 * playhead across retries; toggle the ending between recovering on the last
 * retry or exhausting into the DLQ. React port of demo-recovery.js (HTML + RAF).
 */

interface StateStyle {
  c: string;
  soft: string;
  line: string;
}
const STATES: Record<string, StateStyle> = {
  Queued: {
    c: "var(--indigo-br)",
    soft: "var(--indigo-soft)",
    line: "var(--indigo-line)",
  },
  Running: {
    c: "var(--cyan)",
    soft: "color-mix(in oklch,var(--cyan) 14%,transparent)",
    line: "color-mix(in oklch,var(--cyan) 40%,transparent)",
  },
  Failed: {
    c: "var(--red)",
    soft: "color-mix(in oklch,var(--red) 13%,transparent)",
    line: "color-mix(in oklch,var(--red) 42%,transparent)",
  },
  Retrying: {
    c: "var(--amber)",
    soft: "color-mix(in oklch,var(--amber) 14%,transparent)",
    line: "color-mix(in oklch,var(--amber) 42%,transparent)",
  },
  Complete: {
    c: "var(--grn)",
    soft: "color-mix(in oklch,var(--grn) 14%,transparent)",
    line: "color-mix(in oklch,var(--grn) 42%,transparent)",
  },
  Dead: { c: "var(--txt2)", soft: "var(--panel3)", line: "var(--line3)" },
};

interface Event {
  t: number;
  state: string;
  att: number;
  ttl: string;
  d: string;
}
const TAIL = 1400;
function base(): Event[] {
  return [
    {
      t: 0,
      state: "Queued",
      att: 0,
      ttl: "Enqueued",
      d: "Accepted into the queue · status pending",
    },
    {
      t: 800,
      state: "Running",
      att: 1,
      ttl: "Dispatched",
      d: "Worker picked up the job · attempt 1",
    },
    {
      t: 2600,
      state: "Failed",
      att: 1,
      ttl: "Error",
      d: "ConnectionError: upstream returned 503",
    },
    {
      t: 3000,
      state: "Retrying",
      att: 1,
      ttl: "Backoff",
      d: "Waiting 2.0s before retry 2",
    },
    {
      t: 5000,
      state: "Running",
      att: 2,
      ttl: "Dispatched",
      d: "Worker picked up the job · attempt 2",
    },
    {
      t: 6800,
      state: "Failed",
      att: 2,
      ttl: "Error",
      d: "ConnectionError: upstream returned 503",
    },
    {
      t: 7200,
      state: "Retrying",
      att: 2,
      ttl: "Backoff",
      d: "Waiting 4.0s before retry 3",
    },
    {
      t: 11200,
      state: "Running",
      att: 3,
      ttl: "Dispatched",
      d: "Worker picked up the job · attempt 3",
    },
  ];
}
const SCEN: Record<string, Event[]> = {
  recover: base().concat([
    {
      t: 12700,
      state: "Complete",
      att: 3,
      ttl: "Success",
      d: "Returned in 1.5s · result written to store",
    },
  ]),
  dlq: base().concat([
    {
      t: 13000,
      state: "Failed",
      att: 3,
      ttl: "Error",
      d: "ConnectionError: upstream returned 503",
    },
    {
      t: 13300,
      state: "Dead",
      att: 3,
      ttl: "Dead-letter",
      d: "Max retries (3) exhausted → moved to DLQ",
    },
  ]),
};

const durationOf = (events: Event[]) => events[events.length - 1].t + TAIL;

type AttemptResult = "" | "pending" | "fail" | "ok" | "dead";

export default function RecoveryDemo(_props: DemoProps) {
  const reduced = useReducedMotion();
  const [scen, setScen] = useState<"recover" | "dlq">("recover");
  const [playing, setPlaying] = useState(false);
  const playRef = useRef(0);
  const lastT = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  const events = SCEN[scen];
  const DUR = durationOf(events);

  const stopPlay = useCallback(() => setPlaying(false), []);

  const tick = useCallback(
    (now: number) => {
      if (!lastT.current) lastT.current = now;
      const dt = now - lastT.current;
      lastT.current = now;
      playRef.current += dt;
      if (playRef.current >= DUR) {
        playRef.current = DUR;
        setPlaying(false);
      }
      repaint();
    },
    [DUR],
  );

  useRafLoop(tick, playing && !reduced);

  // Reduced motion mid-playback: jump to the end and drop the stale "Pause" state.
  useEffect(() => {
    if (reduced && playing) {
      playRef.current = DUR;
      setPlaying(false);
      repaint();
    }
  }, [reduced, playing, DUR]);

  const startPlay = useCallback(() => {
    if (reduced) {
      playRef.current = DUR;
      repaint();
      return;
    }
    if (playRef.current >= DUR) playRef.current = 0;
    lastT.current = 0;
    setPlaying(true);
  }, [reduced, DUR]);

  // Auto-play on open; startPlay() shows the finished frame under reduced motion.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount.
  useEffect(() => {
    startPlay();
  }, []);

  const setFromX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const r = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      playRef.current = ratio * DUR;
      stopPlay();
      repaint();
    },
    [DUR, stopPlay],
  );

  const dragging = useRef(false);

  // Keep the current log row scrolled into view.
  const play = playRef.current;
  let idx = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].t <= play + 0.001) idx = i;
    else break;
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the active event row changes
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const cur = log.querySelector<HTMLElement>(".fr-ev.cur");
    if (cur) {
      const top = cur.offsetTop - log.clientHeight / 2 + cur.clientHeight / 2;
      log.scrollTop = Math.max(0, top);
    }
  }, [idx, scen]);

  const ev = events[idx];
  const st = STATES[ev.state];
  const pct = (play / DUR) * 100;

  // attempt chips
  const res: Record<number, AttemptResult> = { 1: "", 2: "", 3: "" };
  for (let i = 0; i <= idx; i++) {
    const e = events[i];
    if (e.att >= 1) {
      if (e.state === "Running" && !res[e.att]) res[e.att] = "pending";
      if (e.state === "Failed") res[e.att] = "fail";
      if (e.state === "Complete") res[e.att] = "ok";
      if (e.state === "Dead") res[e.att] = "dead";
    }
  }
  const attemptGlyph: Record<AttemptResult, string> = {
    "": "",
    pending: "",
    fail: "✕",
    ok: "✓",
    dead: "☠",
  };

  // next-retry / result meta
  let nxKey = "Next retry";
  let nxVal = "—";
  let nxColor = "var(--mut)";
  if (ev.state === "Retrying") {
    const nxt = idx + 1 < events.length ? events[idx + 1].t : DUR;
    nxVal = `${Math.max(0, (nxt - play) / 1000).toFixed(1)}s`;
    nxColor = "var(--amber)";
  } else if (ev.state === "Complete") {
    nxKey = "Result";
    nxVal = "stored";
    nxColor = "var(--grn)";
  } else if (ev.state === "Dead") {
    nxKey = "Routed to";
    nxVal = "DLQ";
    nxColor = "var(--txt2)";
  } else if (ev.state === "Running") {
    nxKey = "Worker";
    nxVal = "busy";
    nxColor = "var(--cyan)";
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const stepK = DUR / 40;
    if (e.key === "ArrowRight") playRef.current = Math.min(DUR, play + stepK);
    else if (e.key === "ArrowLeft") playRef.current = Math.max(0, play - stepK);
    else if (e.key === "Home") playRef.current = 0;
    else if (e.key === "End") playRef.current = DUR;
    else return;
    e.preventDefault();
    stopPlay();
    repaint();
  };

  return (
    <div className="dm-frame-react">
      <div className="demo-bar">
        <span className="title">
          <span className="ld" />
          job 01J8…f3 · lifecycle
        </span>
        <div className="demo-controls">
          <button
            type="button"
            className="ctl"
            onClick={() => (playing ? stopPlay() : startPlay())}
          >
            {playing ? (
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
            {playing ? "Pause" : "Play"}
          </button>
          {/* biome-ignore lint/a11y/useSemanticElements: segmented toggle of aria-pressed buttons; a fieldset/legend would fight the inline-flex .seg styling */}
          <div className="seg" role="group" aria-label="Outcome">
            {(
              [
                { v: "recover", cls: "good", label: "Recovers" },
                { v: "dlq", cls: "bad", label: "Dead-letter" },
              ] as const
            ).map((opt) => {
              const on = scen === opt.v;
              return (
                <button
                  type="button"
                  key={opt.v}
                  className={opt.cls}
                  data-on={on ? "1" : "0"}
                  aria-pressed={on}
                  onClick={() => {
                    setScen(opt.v);
                    playRef.current = Math.min(
                      playRef.current,
                      durationOf(SCEN[opt.v]),
                    );
                    stopPlay();
                    repaint();
                  }}
                >
                  <span className="dot" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="fr-scrubwrap">
        <div
          className="fr-track"
          ref={trackRef}
          tabIndex={0}
          role="slider"
          aria-label="Job timeline scrubber"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            setFromX(e.clientX);
          }}
          onPointerMove={(e) => {
            if (dragging.current) setFromX(e.clientX);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
        >
          <div className="fr-rail">
            {events.map((e, i) => {
              const a = e.t;
              const b = i + 1 < events.length ? events[i + 1].t : DUR;
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed event list
                  key={`seg${i}`}
                  className="fr-seg"
                  style={{
                    left: `${(a / DUR) * 100}%`,
                    width: `${((b - a) / DUR) * 100}%`,
                    background: `color-mix(in oklch,${STATES[e.state].c} 30%, transparent)`,
                  }}
                />
              );
            })}
          </div>
          <div className="fr-fill" style={{ width: `${pct}%` }} />
          {events.map((e, i) =>
            i > 0 ? (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed event list
                key={`tick${i}`}
                className="fr-tick"
                style={{
                  left: `${(e.t / DUR) * 100}%`,
                  background: STATES[e.state].c,
                }}
              />
            ) : null,
          )}
          <div className="fr-handle" style={{ left: `${pct}%` }} />
        </div>
        <div className="fr-axis">
          <span>0.0s</span>
          <span>{(DUR / 2000).toFixed(1)}s</span>
          <span>{(DUR / 1000).toFixed(1)}s</span>
        </div>
      </div>

      <div className="fr-grid">
        <div className="fr-state">
          <span
            className="fr-pill"
            style={{ color: st.c, background: st.soft, borderColor: st.line }}
          >
            <span className="pd" style={{ background: st.c }} />
            {ev.state}
          </span>
          <div className="big">
            <b>{ev.ttl}.</b> {ev.d}
          </div>
          <div className="fr-meta">
            <div className="m">
              <span className="k">Elapsed</span>
              <span className="v">{(play / 1000).toFixed(1)}s</span>
            </div>
            <div className="m">
              <span className="k">Attempt</span>
              <span className="v">{ev.att} / 3</span>
            </div>
            <div className="m">
              <span className="k">{nxKey}</span>
              <span className="v" style={{ color: nxColor }}>
                {nxVal}
              </span>
            </div>
          </div>
          <div>
            <div className="fr-attlabel">Attempts</div>
            <div className="fr-attempts">
              {[1, 2, 3].map((a) => {
                const r = res[a];
                const cls =
                  r === "ok"
                    ? "ok"
                    : r === "fail"
                      ? "fail"
                      : r === "dead"
                        ? "dead"
                        : "";
                return (
                  <span key={a} style={{ display: "contents" }}>
                    <div className={`a ${cls}`} title={`attempt ${a}`}>
                      {attemptGlyph[r] || a}
                    </div>
                    {a < 3 ? <span className="sep">›</span> : null}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="fr-log" ref={logRef}>
          {events.map((e, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed event list
              key={`ev${i}`}
              className={`fr-ev${i <= idx ? " on" : ""}${i === idx ? " cur" : ""}`}
              style={{ "--c": STATES[e.state].c } as React.CSSProperties}
            >
              <div className="dotcol">
                <span className="ed" />
                <span className="eline" />
              </div>
              <div className="etxt">
                <span className="et">{e.ttl}</span>
                <span className="ed2">{e.d}</span>
              </div>
              <span className="ets">{(e.t / 1000).toFixed(1)}s</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
