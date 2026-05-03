import type { ReactNode } from "react";

type Station = {
  id: string;
  label: string;
  hint: string;
  cx: number;
  glyph: ReactNode;
};

const VIEW_W = 460;
const VIEW_H = 130;
const TRACK_Y = 50;
const STATION_W = 56;
const STATION_H = 44;

const STATIONS: Station[] = [
  {
    id: "enqueue",
    label: "enqueue",
    hint: ".delay()",
    cx: 56,
    glyph: <CodeGlyph />,
  },
  {
    id: "queue",
    label: "queue",
    hint: "SQLite · Postgres",
    cx: 184,
    glyph: <DatabaseGlyph />,
  },
  {
    id: "worker",
    label: "worker",
    hint: "Rust pool",
    cx: 304,
    glyph: <WorkerGlyph />,
  },
  {
    id: "result",
    label: "result",
    hint: ".result()",
    cx: 412,
    glyph: <CheckGlyph />,
  },
];

const JOB_DELAYS = ["0s", "-1.7s", "-3.4s"] as const;

export function HowItWorks() {
  return (
    <section className="px-4 pb-20 max-w-3xl mx-auto w-full">
      <div className="text-center mb-10">
        <h2 className="font-handwritten text-3xl sm:text-4xl text-fd-foreground mb-2">
          how it works
        </h2>
        <p className="text-sm text-fd-muted-foreground">
          Your code calls{" "}
          <code className="font-mono text-fd-primary/90">.delay()</code> · the
          job durably queues · a Rust scheduler routes it · a worker returns the
          result.
        </p>
      </div>
      <div className="flex justify-center">
        <svg
          role="img"
          aria-label="Job lifecycle: enqueue from your code, durable queue, Rust worker pool, result returned"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full max-w-2xl taskito-flow"
        >
          <defs>
            <filter id="taskito-flow-sketch">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.04"
                numOctaves="2"
                seed="3"
              />
              <feDisplacementMap in="SourceGraphic" scale="1.4" />
            </filter>
            <marker
              id="taskito-flow-arrow"
              viewBox="0 0 12 12"
              refX="9"
              refY="6"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path
                d="M 1 1 L 10 6 L 1 11"
                fill="none"
                stroke="var(--color-fd-sketch-strong)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>
          </defs>

          {STATIONS.slice(0, -1).map((station, i) => {
            const next = STATIONS[i + 1];
            return (
              <line
                key={station.id}
                x1={station.cx + STATION_W / 2 + 4}
                y1={TRACK_Y}
                x2={next.cx - STATION_W / 2 - 8}
                y2={TRACK_Y}
                stroke="var(--color-fd-sketch)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="2 5"
                markerEnd="url(#taskito-flow-arrow)"
                filter="url(#taskito-flow-sketch)"
              />
            );
          })}

          {STATIONS.map((station) => (
            <StationNode key={station.id} station={station} />
          ))}

          {JOB_DELAYS.map((delay, index) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list
              key={index}
              cx={STATIONS[0].cx}
              cy={TRACK_Y}
              r="4"
              fill="var(--color-fd-primary)"
              className="taskito-flow-job"
              style={{ animationDelay: delay }}
            />
          ))}
        </svg>
      </div>
      <FlowStyles />
    </section>
  );
}

function StationNode({ station }: { station: Station }) {
  const isWorker = station.id === "worker";
  const x = station.cx - STATION_W / 2;
  const y = TRACK_Y - STATION_H / 2;
  return (
    <g className="taskito-flow-station">
      <rect
        x={x}
        y={y}
        width={STATION_W}
        height={STATION_H}
        rx="6"
        fill="var(--color-fd-card)"
        stroke="var(--color-fd-sketch-strong)"
        strokeWidth="1.75"
        filter="url(#taskito-flow-sketch)"
      />
      <g
        transform={`translate(${station.cx - 8}, ${TRACK_Y - 8})`}
        className="taskito-flow-station-glyph"
      >
        {station.glyph}
      </g>
      {isWorker ? (
        <circle
          cx={station.cx}
          cy={TRACK_Y}
          r={STATION_W / 2 + 4}
          fill="none"
          stroke="var(--color-fd-primary)"
          strokeWidth="1.4"
          strokeDasharray="3 6"
          opacity="0.7"
          className="taskito-flow-worker-spinner"
          style={{ transformOrigin: `${station.cx}px ${TRACK_Y}px` }}
        />
      ) : null}
      <text
        x={station.cx}
        y={TRACK_Y + STATION_H / 2 + 18}
        textAnchor="middle"
        fill="var(--color-fd-foreground)"
        fontSize="16"
        fontWeight="600"
        fontFamily="var(--font-handwritten), 'Shantell Sans', cursive"
      >
        {station.label}
      </text>
      <text
        x={station.cx}
        y={TRACK_Y + STATION_H / 2 + 32}
        textAnchor="middle"
        fill="var(--color-fd-muted-foreground)"
        fontSize="9"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        opacity="0.7"
      >
        {station.hint}
      </text>
    </g>
  );
}

function CodeGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-fd-foreground)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
    >
      <title>code</title>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function DatabaseGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-fd-foreground)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
    >
      <title>database</title>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  );
}

function WorkerGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="var(--color-fd-foreground)"
      role="img"
    >
      <title>worker pool</title>
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="18" cy="12" r="2.4" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-fd-primary)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
    >
      <title>check</title>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function FlowStyles() {
  return (
    <style>{`
      .taskito-flow .taskito-flow-station {
        transition: transform 200ms ease;
      }
      .taskito-flow .taskito-flow-station:hover {
        transform: translateY(-1.5px);
      }
      @keyframes taskito-flow-job-travel {
        0%   { cx: 56px;  opacity: 0; }
        4%   { opacity: 1; }
        24%  { cx: 184px; opacity: 1; }
        32%  { cx: 184px; opacity: 1; }
        50%  { cx: 304px; opacity: 1; }
        58%  { cx: 304px; opacity: 1; }
        80%  { cx: 412px; opacity: 1; }
        92%  { opacity: 0; }
        100% { cx: 56px;  opacity: 0; }
      }
      @keyframes taskito-flow-worker-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: no-preference) {
        .taskito-flow .taskito-flow-job {
          animation: taskito-flow-job-travel 5.1s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
          filter: drop-shadow(0 0 4px var(--color-fd-primary));
        }
        .taskito-flow .taskito-flow-worker-spinner {
          animation: taskito-flow-worker-spin 7s linear infinite;
        }
      }
    `}</style>
  );
}
