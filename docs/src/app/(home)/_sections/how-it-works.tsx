import type { ReactNode } from "react";

type Station = {
  id: string;
  label: string;
  hint: string;
  cx: number;
  glyph: ReactNode;
};

const VIEW_WIDTH = 380;
const TRACK_Y = 36;
const STATION_RADIUS = 14;

const STATIONS: Station[] = [
  {
    id: "enqueue",
    label: "enqueue",
    hint: ".delay()",
    cx: 40,
    glyph: <CodeGlyph />,
  },
  {
    id: "queue",
    label: "queue",
    hint: "SQLite · Postgres",
    cx: 145,
    glyph: <DatabaseGlyph />,
  },
  {
    id: "worker",
    label: "worker",
    hint: "Rust pool",
    cx: 250,
    glyph: <WorkerGlyph />,
  },
  {
    id: "result",
    label: "result",
    hint: ".result()",
    cx: 340,
    glyph: <CheckGlyph />,
  },
];

const JOB_DELAYS = ["0s", "-1.6s", "-3.2s"] as const;

export function HowItWorks() {
  return (
    <section className="px-4 pb-20 max-w-3xl mx-auto w-full">
      <div className="text-center mb-8">
        <h2 className="text-xs uppercase tracking-[0.2em] text-fd-muted-foreground font-semibold mb-1">
          How it works
        </h2>
        <p className="text-sm text-fd-muted-foreground/70">
          Your code calls{" "}
          <code className="font-mono text-fd-primary/80">.delay()</code> · the
          job durably queues · a Rust scheduler routes it · a worker returns the
          result.
        </p>
      </div>
      <div className="flex justify-center">
        <svg
          role="img"
          aria-label="Job lifecycle: enqueue from your code, durable queue, Rust worker pool, result returned"
          viewBox={`0 0 ${VIEW_WIDTH} 88`}
          className="w-full max-w-2xl taskito-flow"
        >
          <defs>
            <linearGradient
              id="taskito-track-gradient"
              x1="0"
              y1="0"
              x2={VIEW_WIDTH}
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor="var(--color-fd-border)" />
              <stop
                offset="0.5"
                stopColor="var(--color-fd-primary)"
                stopOpacity="0.4"
              />
              <stop offset="1" stopColor="var(--color-fd-border)" />
            </linearGradient>
            <radialGradient id="taskito-job-aura" cx="0.5" cy="0.5" r="0.5">
              <stop
                offset="0"
                stopColor="var(--color-fd-primary)"
                stopOpacity="0.7"
              />
              <stop
                offset="1"
                stopColor="var(--color-fd-primary)"
                stopOpacity="0"
              />
            </radialGradient>
          </defs>

          <BackgroundGrid />

          <line
            x1={STATIONS[0].cx}
            y1={TRACK_Y}
            x2={STATIONS[STATIONS.length - 1].cx}
            y2={TRACK_Y}
            stroke="url(#taskito-track-gradient)"
            strokeWidth="1.5"
            strokeDasharray="3 5"
            className="taskito-track"
          />

          {STATIONS.map((station) => (
            <StationNode key={station.id} station={station} />
          ))}

          {JOB_DELAYS.map((delay, index) => (
            <g
              // biome-ignore lint/suspicious/noArrayIndexKey: stable phased delays
              key={index}
              style={{ animationDelay: delay }}
              className="taskito-job"
            >
              <circle
                cx={STATIONS[0].cx}
                cy={TRACK_Y}
                r="9"
                fill="url(#taskito-job-aura)"
                className="taskito-job-aura"
              />
              <circle
                cx={STATIONS[0].cx}
                cy={TRACK_Y}
                r="3.5"
                fill="var(--color-fd-primary)"
                className="taskito-job-dot"
              />
            </g>
          ))}
        </svg>
      </div>
      <FlowStyles />
    </section>
  );
}

function StationNode({ station }: { station: Station }) {
  const isWorker = station.id === "worker";
  const isResult = station.id === "result";
  return (
    <g className="taskito-station">
      <circle
        cx={station.cx}
        cy={TRACK_Y}
        r={STATION_RADIUS}
        fill="var(--color-fd-card)"
        stroke="var(--color-fd-border)"
        strokeWidth="1.5"
      />
      {isWorker ? (
        <circle
          cx={station.cx}
          cy={TRACK_Y}
          r={STATION_RADIUS + 3}
          fill="none"
          stroke="var(--color-fd-primary)"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          className="taskito-worker-spinner"
          style={{ transformOrigin: `${station.cx}px ${TRACK_Y}px` }}
        />
      ) : null}
      {isResult ? (
        <circle
          cx={station.cx}
          cy={TRACK_Y}
          r={STATION_RADIUS + 4}
          fill="none"
          stroke="var(--color-fd-primary)"
          strokeWidth="1"
          opacity="0"
          className="taskito-result-pulse"
        />
      ) : null}
      <g
        transform={`translate(${station.cx - 7}, ${TRACK_Y - 7})`}
        className="taskito-station-glyph"
      >
        {station.glyph}
      </g>
      <text
        x={station.cx}
        y={TRACK_Y + 26}
        textAnchor="middle"
        fill="var(--color-fd-foreground)"
        fontSize="10"
        fontWeight="600"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        className="taskito-station-label"
      >
        {station.label}
      </text>
      <text
        x={station.cx}
        y={TRACK_Y + 39}
        textAnchor="middle"
        fill="var(--color-fd-muted-foreground)"
        fontSize="8"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        opacity="0.7"
      >
        {station.hint}
      </text>
    </g>
  );
}

function BackgroundGrid() {
  const dots = [];
  const step = 14;
  for (let x = 8; x < VIEW_WIDTH; x += step) {
    for (let y = 4; y < 84; y += step) {
      dots.push(
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r="0.7"
          fill="var(--color-fd-muted-foreground)"
          opacity="0.08"
        />,
      );
    }
  }
  return <g aria-hidden>{dots}</g>;
}

function CodeGlyph() {
  return (
    <svg
      width="14"
      height="14"
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
      width="14"
      height="14"
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
      width="14"
      height="14"
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
      width="14"
      height="14"
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
      .taskito-flow .taskito-station {
        transition: transform 200ms ease;
      }
      .taskito-flow .taskito-station:hover {
        transform: translateY(-1px);
      }
      .taskito-flow .taskito-station:hover .taskito-station-label {
        fill: var(--color-fd-primary);
      }
      @keyframes taskito-job-travel {
        0%   { cx: 40px;  opacity: 0; }
        4%   { opacity: 1; }
        25%  { cx: 145px; opacity: 1; }
        33%  { cx: 145px; opacity: 1; }
        50%  { cx: 250px; opacity: 1; }
        58%  { cx: 250px; opacity: 1; }
        80%  { cx: 340px; opacity: 1; }
        92%  { opacity: 0; }
        100% { cx: 40px;  opacity: 0; }
      }
      @keyframes taskito-worker-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @keyframes taskito-result-pulse {
        0%, 70% { r: 18px; opacity: 0; }
        80%     { r: 18px; opacity: 0.6; }
        100%    { r: 26px; opacity: 0; }
      }
      @keyframes taskito-track-shimmer {
        0%   { stroke-dashoffset: 0; }
        100% { stroke-dashoffset: -16; }
      }
      @media (prefers-reduced-motion: no-preference) {
        .taskito-flow .taskito-job-dot {
          animation: taskito-job-travel 4.8s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
          filter: drop-shadow(0 0 3px var(--color-fd-primary));
        }
        .taskito-flow .taskito-job-aura {
          animation: taskito-job-travel 4.8s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
        }
        .taskito-flow .taskito-worker-spinner {
          animation: taskito-worker-spin 6s linear infinite;
        }
        .taskito-flow .taskito-result-pulse {
          animation: taskito-result-pulse 4.8s ease-out infinite;
        }
        .taskito-flow .taskito-track {
          animation: taskito-track-shimmer 1.6s linear infinite;
        }
      }
    `}</style>
  );
}
