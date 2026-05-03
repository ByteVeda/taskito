const WORKERS = [
  { id: 0, x: 0, y: 0, delay: "0s", duration: "2.4s" },
  { id: 1, x: 1, y: 0, delay: "-0.4s", duration: "2.8s" },
  { id: 2, x: 2, y: 0, delay: "-1.1s", duration: "2.6s" },
  { id: 3, x: 0, y: 1, delay: "-0.7s", duration: "3.1s" },
  { id: 4, x: 1, y: 1, delay: "-1.6s", duration: "2.5s" },
  { id: 5, x: 2, y: 1, delay: "-0.2s", duration: "2.9s" },
] as const;

const INCOMING_JOBS = [
  { delay: "0s" },
  { delay: "-0.6s" },
  { delay: "-1.2s" },
  { delay: "-1.8s" },
] as const;

const RESULTS = [
  { delay: "-0.3s" },
  { delay: "-0.9s" },
  { delay: "-1.5s" },
] as const;

const VIEW_W = 580;
const VIEW_H = 170;
const POOL_LEFT = 210;
const POOL_TOP = 50;
const WORKER_SIZE = 38;
const WORKER_GAP = 12;
const POOL_WIDTH = 3 * WORKER_SIZE + 2 * WORKER_GAP;
const POOL_HEIGHT = 2 * WORKER_SIZE + 1 * WORKER_GAP;
const POOL_RIGHT = POOL_LEFT + POOL_WIDTH;
const TRACK_Y = POOL_TOP + POOL_HEIGHT / 2;
const INCOMING_LEFT = 30;
const RESULT_LEFT = POOL_RIGHT + 30;
const RESULT_END = VIEW_W - 30;

export function WorkerPool() {
  return (
    <section className="px-4 pb-24 max-w-3xl mx-auto w-full">
      <div className="text-center mb-10">
        <h2 className="font-handwritten text-3xl sm:text-4xl text-fd-foreground mb-2">
          six workers, constant flow
        </h2>
        <p className="text-sm text-fd-muted-foreground">
          Jobs stream in, workers pick them up, results stream out. No broker
          between them.
        </p>
      </div>
      <div className="flex justify-center">
        <svg
          role="img"
          aria-label="Six-worker pool with jobs streaming in from the left and results streaming out to the right"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full max-w-2xl taskito-pool"
        >
          <defs>
            <filter id="taskito-pool-sketch">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.025"
                numOctaves="2"
                seed="7"
              />
              <feDisplacementMap in="SourceGraphic" scale="0.7" />
            </filter>
            <marker
              id="taskito-pool-arrow"
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
                stroke="var(--color-fd-sketch-accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>
          </defs>

          <LaneLabels />
          <Lanes />

          {INCOMING_JOBS.map((job, i) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list
              key={`incoming-${i}`}
              cx={INCOMING_LEFT}
              cy={TRACK_Y}
              r="4"
              fill="var(--color-fd-primary)"
              className="taskito-incoming-dot"
              style={{ animationDelay: job.delay }}
            />
          ))}

          {WORKERS.map((worker) => (
            <Worker key={worker.id} worker={worker} />
          ))}

          {RESULTS.map((result, i) => (
            <g
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list
              key={`result-${i}`}
              transform={`translate(${RESULT_LEFT} ${TRACK_Y})`}
              className="taskito-result"
              style={{ animationDelay: result.delay }}
            >
              <circle
                r="8"
                fill="var(--color-fd-card)"
                stroke="var(--color-fd-primary)"
                strokeWidth="2"
                filter="url(#taskito-pool-sketch)"
              />
              <path
                d="m -3.5 0.5 l 2.5 2.5 l 4.5 -4.5"
                stroke="var(--color-fd-primary)"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
          ))}

          <text
            x={POOL_LEFT + POOL_WIDTH / 2}
            y={POOL_TOP + POOL_HEIGHT + 28}
            textAnchor="middle"
            fill="var(--color-fd-muted-foreground)"
            fontSize="14"
            fontFamily="var(--font-handwritten), 'Shantell Sans', cursive"
            fontWeight="500"
          >
            6 workers · 0 brokers
          </text>
        </svg>
      </div>
      <PoolStyles />
    </section>
  );
}

function LaneLabels() {
  const labels = [
    { x: INCOMING_LEFT, text: "incoming" },
    { x: POOL_LEFT, text: "workers" },
    { x: RESULT_LEFT, text: "results" },
  ];
  return (
    <>
      {labels.map((label) => (
        <text
          key={label.text}
          x={label.x}
          y="28"
          fill="var(--color-fd-foreground)"
          fontSize="17"
          fontFamily="var(--font-handwritten), 'Shantell Sans', cursive"
          fontWeight="600"
        >
          {label.text}
        </text>
      ))}
    </>
  );
}

function Lanes() {
  return (
    <>
      <line
        x1={INCOMING_LEFT}
        y1={TRACK_Y}
        x2={POOL_LEFT - 10}
        y2={TRACK_Y}
        stroke="var(--color-fd-sketch-accent)"
        strokeWidth="1.75"
        strokeDasharray="2 6"
        strokeLinecap="round"
        markerEnd="url(#taskito-pool-arrow)"
        filter="url(#taskito-pool-sketch)"
      />
      <line
        x1={POOL_RIGHT + 10}
        y1={TRACK_Y}
        x2={RESULT_END - 4}
        y2={TRACK_Y}
        stroke="var(--color-fd-sketch-accent)"
        strokeWidth="1.75"
        strokeDasharray="2 6"
        strokeLinecap="round"
        markerEnd="url(#taskito-pool-arrow)"
        filter="url(#taskito-pool-sketch)"
      />
    </>
  );
}

function Worker({ worker }: { worker: (typeof WORKERS)[number] }) {
  const x = POOL_LEFT + worker.x * (WORKER_SIZE + WORKER_GAP);
  const y = POOL_TOP + worker.y * (WORKER_SIZE + WORKER_GAP);
  const cx = x + WORKER_SIZE / 2;
  const cy = y + WORKER_SIZE / 2;
  return (
    <g
      style={
        {
          "--worker-delay": worker.delay,
          "--worker-duration": worker.duration,
        } as React.CSSProperties
      }
      className="taskito-worker"
    >
      <rect
        x={x}
        y={y}
        width={WORKER_SIZE}
        height={WORKER_SIZE}
        rx="7"
        fill="var(--color-fd-card)"
        stroke="var(--color-fd-sketch-strong)"
        strokeWidth="2.25"
        filter="url(#taskito-pool-sketch)"
      />
      <circle
        cx={cx}
        cy={cy}
        r="7"
        fill="none"
        stroke="var(--color-fd-primary)"
        strokeWidth="1.4"
        className="taskito-worker-ring"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      <circle
        cx={cx}
        cy={cy}
        r="3"
        fill="var(--color-fd-muted-foreground)"
        opacity="0.65"
      />
      <circle
        cx={cx}
        cy={cy}
        r="3"
        fill="var(--color-fd-primary)"
        className="taskito-worker-dot-active"
      />
    </g>
  );
}

function PoolStyles() {
  return (
    <style>{`
      @keyframes taskito-incoming-flow {
        0%   { cx: ${INCOMING_LEFT}px; opacity: 0; }
        10%  { opacity: 1; }
        88%  { cx: ${POOL_LEFT - 8}px; opacity: 1; }
        100% { cx: ${POOL_LEFT - 8}px; opacity: 0; }
      }
      @keyframes taskito-result-flow {
        0%   { transform: translate(${RESULT_LEFT}px, ${TRACK_Y}px); opacity: 0; }
        10%  { opacity: 1; }
        90%  { transform: translate(${RESULT_END - 4}px, ${TRACK_Y}px); opacity: 1; }
        100% { transform: translate(${RESULT_END - 4}px, ${TRACK_Y}px); opacity: 0; }
      }
      @keyframes taskito-worker-active-pulse {
        0%, 35%   { opacity: 0; transform: scale(0.6); }
        50%       { opacity: 1; transform: scale(1); }
        85%       { opacity: 1; transform: scale(1); }
        100%      { opacity: 0; transform: scale(0.6); }
      }
      @keyframes taskito-worker-ring-pulse {
        0%, 35%   { opacity: 0; transform: scale(0.55); }
        55%       { opacity: 0.55; transform: scale(1.5); }
        100%      { opacity: 0; transform: scale(2.1); }
      }
      .taskito-pool .taskito-worker-dot-active {
        opacity: 0;
        transform-box: fill-box;
        transform-origin: center;
      }
      .taskito-pool .taskito-worker-ring {
        opacity: 0;
        transform-box: fill-box;
      }
      @media (prefers-reduced-motion: no-preference) {
        .taskito-pool .taskito-incoming-dot {
          animation: taskito-incoming-flow 2.4s linear infinite;
          filter: drop-shadow(0 0 3px var(--color-fd-primary));
        }
        .taskito-pool .taskito-result {
          animation: taskito-result-flow 2.4s linear infinite;
        }
        .taskito-pool .taskito-worker-dot-active {
          animation: taskito-worker-active-pulse var(--worker-duration) ease-in-out infinite;
          animation-delay: var(--worker-delay);
        }
        .taskito-pool .taskito-worker-ring {
          animation: taskito-worker-ring-pulse var(--worker-duration) ease-out infinite;
          animation-delay: var(--worker-delay);
        }
      }
    `}</style>
  );
}
