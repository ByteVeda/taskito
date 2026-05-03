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

const POOL_LEFT = 180;
const POOL_TOP = 30;
const WORKER_SIZE = 32;
const WORKER_GAP = 10;
const POOL_WIDTH = 3 * WORKER_SIZE + 2 * WORKER_GAP;
const POOL_HEIGHT = 2 * WORKER_SIZE + 1 * WORKER_GAP;
const VIEW_W = 560;
const VIEW_H = 130;
const POOL_RIGHT = POOL_LEFT + POOL_WIDTH;

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
          <defs>
            <linearGradient
              id="taskito-pool-incoming"
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop
                offset="0"
                stopColor="var(--color-fd-primary)"
                stopOpacity="0"
              />
              <stop
                offset="1"
                stopColor="var(--color-fd-primary)"
                stopOpacity="0.85"
              />
            </linearGradient>
            <linearGradient
              id="taskito-pool-outgoing"
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop
                offset="0"
                stopColor="var(--color-fd-primary)"
                stopOpacity="0.85"
              />
              <stop
                offset="1"
                stopColor="var(--color-fd-primary)"
                stopOpacity="0"
              />
            </linearGradient>
          </defs>

          <text
            x="14"
            y="20"
            fill="var(--color-fd-muted-foreground)"
            fontSize="9"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            letterSpacing="0.1em"
          >
            INCOMING
          </text>
          <text
            x={POOL_LEFT}
            y="20"
            fill="var(--color-fd-muted-foreground)"
            fontSize="9"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            letterSpacing="0.1em"
          >
            WORKERS
          </text>
          <text
            x={POOL_RIGHT + 20}
            y="20"
            fill="var(--color-fd-muted-foreground)"
            fontSize="9"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            letterSpacing="0.1em"
          >
            RESULTS
          </text>

          {INCOMING_JOBS.map((job, i) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list
              key={`incoming-${i}`}
              cy={POOL_TOP + POOL_HEIGHT / 2}
              r="4"
              fill="url(#taskito-pool-incoming)"
              className="taskito-pool-incoming"
              style={{ animationDelay: job.delay }}
            />
          ))}

          {WORKERS.map((worker) => {
            const x = POOL_LEFT + worker.x * (WORKER_SIZE + WORKER_GAP);
            const y = POOL_TOP + worker.y * (WORKER_SIZE + WORKER_GAP);
            return (
              <g
                key={worker.id}
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
                  className="taskito-worker-base"
                />
                <rect
                  x={x + 4}
                  y={y + 4}
                  width={WORKER_SIZE - 8}
                  height={WORKER_SIZE - 8}
                  rx="3"
                  fill="var(--color-fd-primary)"
                  className="taskito-worker-active"
                />
              </g>
            );
          })}

          {RESULTS.map((result, i) => (
            <g
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list
              key={`result-${i}`}
              className="taskito-pool-result"
              style={{ animationDelay: result.delay }}
            >
              <circle
                cy={POOL_TOP + POOL_HEIGHT / 2}
                r="6"
                fill="var(--color-fd-card)"
                stroke="var(--color-fd-primary)"
                strokeWidth="1.5"
              />
              <path
                d="m -3 0 l 2 2 l 4 -4"
                stroke="var(--color-fd-primary)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                transform={`translate(0, ${POOL_TOP + POOL_HEIGHT / 2})`}
                className="taskito-pool-result-check"
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

function PoolStyles() {
  return (
    <style>{`
      @keyframes taskito-pool-incoming-flow {
        0%   { cx: 18px;  opacity: 0; }
        10%  { opacity: 1; }
        80%  { cx: ${POOL_LEFT - 8}px; opacity: 1; }
        100% { cx: ${POOL_LEFT - 8}px; opacity: 0; }
      }
      @keyframes taskito-pool-result-flow {
        0%   { cx: ${POOL_RIGHT + 8}px; opacity: 0; }
        10%  { opacity: 1; }
        90%  { cx: ${VIEW_W - 16}px; opacity: 1; }
        100% { cx: ${VIEW_W - 16}px; opacity: 0; }
      }
      @keyframes taskito-worker-pulse {
        0%, 35% {
          opacity: 0;
          transform: scale(0.6);
        }
        45%     {
          opacity: 1;
          transform: scale(1);
        }
        80%     {
          opacity: 1;
          transform: scale(1);
        }
        100%    {
          opacity: 0;
          transform: scale(0.6);
        }
      }
      @media (prefers-reduced-motion: no-preference) {
        .taskito-pool .taskito-pool-incoming {
          animation: taskito-pool-incoming-flow 2s linear infinite;
          filter: drop-shadow(0 0 3px var(--color-fd-primary));
        }
        .taskito-pool .taskito-pool-result {
          animation: taskito-pool-result-flow 2s linear infinite;
        }
        .taskito-pool .taskito-worker-active {
          transform-box: fill-box;
          transform-origin: center;
          animation: taskito-worker-pulse var(--worker-duration) ease-in-out infinite;
          animation-delay: var(--worker-delay);
        }
      }
      .taskito-pool .taskito-worker-active {
        opacity: 0;
        transform-box: fill-box;
        transform-origin: center;
      }
    `}</style>
  );
}
