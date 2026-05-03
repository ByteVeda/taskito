import { SectionHeader } from "@/components/ui";

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

const VIEW_W = 560;
const VIEW_H = 150;
const POOL_LEFT = 200;
const POOL_TOP = 38;
const WORKER_SIZE = 34;
const WORKER_GAP = 10;
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
      <SectionHeader
        title="Six workers. Constant flow."
        description="Jobs stream in, workers pick them up, results stream out. No broker between them."
      />
      <div className="flex justify-center">
        <svg
          role="img"
          aria-label="Six-worker pool with jobs streaming in from the left and results streaming out to the right"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full max-w-2xl taskito-pool"
        >
          <LaneLabels />
          <Lanes />

          {INCOMING_JOBS.map((job, i) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list
              key={`incoming-${i}`}
              cx={INCOMING_LEFT}
              cy={TRACK_Y}
              r="3.5"
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
                r="7"
                fill="var(--color-fd-card)"
                stroke="var(--color-fd-primary)"
                strokeWidth="1.5"
              />
              <path
                d="m -3.5 0.5 l 2.5 2.5 l 4.5 -4.5"
                stroke="var(--color-fd-primary)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
          ))}

          <text
            x={POOL_LEFT + POOL_WIDTH / 2}
            y={POOL_TOP + POOL_HEIGHT + 22}
            textAnchor="middle"
            fill="var(--color-fd-muted-foreground)"
            fontSize="9"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            opacity="0.7"
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
  return (
    <>
      <text
        x={INCOMING_LEFT}
        y="20"
        fill="var(--color-fd-muted-foreground)"
        fontSize="9"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        letterSpacing="0.15em"
        opacity="0.7"
      >
        INCOMING
      </text>
      <text
        x={POOL_LEFT}
        y="20"
        fill="var(--color-fd-muted-foreground)"
        fontSize="9"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        letterSpacing="0.15em"
        opacity="0.7"
      >
        WORKERS
      </text>
      <text
        x={RESULT_LEFT}
        y="20"
        fill="var(--color-fd-muted-foreground)"
        fontSize="9"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        letterSpacing="0.15em"
        opacity="0.7"
      >
        RESULTS
      </text>
    </>
  );
}

function Lanes() {
  return (
    <>
      <line
        x1={INCOMING_LEFT}
        y1={TRACK_Y}
        x2={POOL_LEFT - 8}
        y2={TRACK_Y}
        stroke="var(--color-fd-border)"
        strokeWidth="1"
        strokeDasharray="2 4"
      />
      <line
        x1={POOL_RIGHT + 8}
        y1={TRACK_Y}
        x2={RESULT_END}
        y2={TRACK_Y}
        stroke="var(--color-fd-border)"
        strokeWidth="1"
        strokeDasharray="2 4"
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
        rx="6"
        fill="var(--color-fd-card)"
        stroke="var(--color-fd-border)"
        strokeWidth="1.5"
      />
      <circle
        cx={cx}
        cy={cy}
        r="6"
        fill="none"
        stroke="var(--color-fd-primary)"
        strokeWidth="1.25"
        className="taskito-worker-ring"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      <circle
        cx={cx}
        cy={cy}
        r="2.75"
        fill="var(--color-fd-muted-foreground)"
        opacity="0.35"
        className="taskito-worker-dot-idle"
      />
      <circle
        cx={cx}
        cy={cy}
        r="2.75"
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
        88%  { cx: ${POOL_LEFT - 6}px; opacity: 1; }
        100% { cx: ${POOL_LEFT - 6}px; opacity: 0; }
      }
      @keyframes taskito-result-flow {
        0%   { transform: translate(${RESULT_LEFT}px, ${TRACK_Y}px); opacity: 0; }
        10%  { opacity: 1; }
        90%  { transform: translate(${RESULT_END}px, ${TRACK_Y}px); opacity: 1; }
        100% { transform: translate(${RESULT_END}px, ${TRACK_Y}px); opacity: 0; }
      }
      @keyframes taskito-worker-active-pulse {
        0%, 35%   { opacity: 0; transform: scale(0.7); }
        50%       { opacity: 1; transform: scale(1); }
        85%       { opacity: 1; transform: scale(1); }
        100%      { opacity: 0; transform: scale(0.7); }
      }
      @keyframes taskito-worker-ring-pulse {
        0%, 35%   { opacity: 0; transform: scale(0.6); }
        55%       { opacity: 0.5; transform: scale(1.4); }
        100%      { opacity: 0; transform: scale(2); }
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
          animation: taskito-incoming-flow 2.2s linear infinite;
          filter: drop-shadow(0 0 2px var(--color-fd-primary));
        }
        .taskito-pool .taskito-result {
          animation: taskito-result-flow 2.2s linear infinite;
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
