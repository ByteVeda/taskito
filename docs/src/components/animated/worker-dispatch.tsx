import type { CSSProperties } from "react";
import {
  Arrow,
  Caption,
  Cylinder,
  DiagramFrame,
  MotionStyles,
  NodeBox,
  SKETCH_FILTER,
} from "./_primitives";

const VIEW_W = 720;
const VIEW_H = 320;

const SCHED_CX = 80;
const SCHED_CY = 160;
const SCHED_W = 120;
const SCHED_H = 60;

const SYNC_LANE_Y = 110;
const ASYNC_LANE_Y = 230;

const WORKER_SIZE = 36;
const WORKER_GAP = 10;
const POOL_LEFT = 232;
const POOL_TOP = SYNC_LANE_Y - WORKER_SIZE - WORKER_GAP / 2;
const POOL_W = 3 * WORKER_SIZE + 2 * WORKER_GAP;
const POOL_RIGHT = POOL_LEFT + POOL_W;

const ASYNC_LEFT = 232;
const ASYNC_W = POOL_W;
const ASYNC_H = 44;
const ASYNC_RIGHT = ASYNC_LEFT + ASYNC_W;

const RESULT_CX = 460;
const RESULT_CY = SCHED_CY;
const RESULT_W = 116;
const RESULT_H = 60;
const RESULT_LEFT = RESULT_CX - RESULT_W / 2;
const RESULT_RIGHT = RESULT_CX + RESULT_W / 2;

const SQLITE_CX = 620;
const SQLITE_CY = SCHED_CY;
const SQLITE_RX = 50;
const SQLITE_RY = 30;

type Worker = {
  id: number;
  cx: number;
  cy: number;
  delay: string;
  duration: string;
};

const WORKERS: Worker[] = [
  {
    id: 0,
    cx: POOL_LEFT + WORKER_SIZE / 2,
    cy: POOL_TOP + WORKER_SIZE / 2,
    delay: "0s",
    duration: "2.4s",
  },
  {
    id: 1,
    cx: POOL_LEFT + WORKER_SIZE * 1.5 + WORKER_GAP,
    cy: POOL_TOP + WORKER_SIZE / 2,
    delay: "-0.4s",
    duration: "2.8s",
  },
  {
    id: 2,
    cx: POOL_LEFT + WORKER_SIZE * 2.5 + WORKER_GAP * 2,
    cy: POOL_TOP + WORKER_SIZE / 2,
    delay: "-1.1s",
    duration: "2.6s",
  },
  {
    id: 3,
    cx: POOL_LEFT + WORKER_SIZE / 2,
    cy: POOL_TOP + WORKER_SIZE * 1.5 + WORKER_GAP,
    delay: "-0.7s",
    duration: "3.1s",
  },
  {
    id: 4,
    cx: POOL_LEFT + WORKER_SIZE * 1.5 + WORKER_GAP,
    cy: POOL_TOP + WORKER_SIZE * 1.5 + WORKER_GAP,
    delay: "-1.6s",
    duration: "2.5s",
  },
  {
    id: 5,
    cx: POOL_LEFT + WORKER_SIZE * 2.5 + WORKER_GAP * 2,
    cy: POOL_TOP + WORKER_SIZE * 1.5 + WORKER_GAP,
    delay: "-0.2s",
    duration: "2.9s",
  },
];

const SYNC_DOTS = ["0s", "-0.6s", "-1.2s", "-1.8s"];
const ASYNC_DOTS = ["-0.3s", "-1.5s"];
const RESULT_DOTS = ["-0.2s", "-1.0s", "-1.7s"];

export function WorkerDispatch() {
  return (
    <DiagramFrame
      ariaLabel="Worker pool dispatch. The Scheduler routes sync jobs to a six-thread worker pool and async jobs to a dedicated async executor; both lanes converge at the Result Channel which writes back to SQLite."
      width={VIEW_W}
      height={VIEW_H}
      className="taskito-dispatch"
    >
      <NodeBox
        cx={SCHED_CX}
        cy={SCHED_CY}
        w={SCHED_W}
        h={SCHED_H}
        label="Scheduler"
        hint="Tokio · 50ms"
        variant="primary"
      />

      <Caption
        x={POOL_LEFT + POOL_W / 2}
        y={POOL_TOP - 20}
        text="sync · 6 worker threads"
      />
      <Caption
        x={ASYNC_LEFT + ASYNC_W / 2}
        y={ASYNC_LANE_Y + ASYNC_H / 2 + 22}
        text="async · dedicated event loop"
      />

      {/* Scheduler -> sync entry */}
      <Arrow
        d={`M ${SCHED_CX + SCHED_W / 2} ${SCHED_CY - 12} Q ${SCHED_CX + SCHED_W / 2 + 30} ${SYNC_LANE_Y} ${POOL_LEFT - 10} ${SYNC_LANE_Y}`}
      />
      {/* Scheduler -> async entry */}
      <Arrow
        d={`M ${SCHED_CX + SCHED_W / 2} ${SCHED_CY + 12} Q ${SCHED_CX + SCHED_W / 2 + 30} ${ASYNC_LANE_Y} ${ASYNC_LEFT - 10} ${ASYNC_LANE_Y}`}
      />
      {/* sync -> result */}
      <Arrow
        d={`M ${POOL_RIGHT + 8} ${SYNC_LANE_Y} Q ${(POOL_RIGHT + RESULT_LEFT) / 2} ${SYNC_LANE_Y} ${RESULT_LEFT - 4} ${RESULT_CY - 12}`}
      />
      {/* async -> result */}
      <Arrow
        d={`M ${ASYNC_RIGHT + 8} ${ASYNC_LANE_Y} Q ${(ASYNC_RIGHT + RESULT_LEFT) / 2} ${ASYNC_LANE_Y} ${RESULT_LEFT - 4} ${RESULT_CY + 12}`}
      />
      {/* result -> SQLite */}
      <Arrow
        d={`M ${RESULT_RIGHT + 4} ${RESULT_CY} L ${SQLITE_CX - SQLITE_RX - 6} ${SQLITE_CY}`}
      />

      {WORKERS.map((w) => (
        <WorkerCell key={w.id} worker={w} />
      ))}

      <NodeBox
        cx={ASYNC_LEFT + ASYNC_W / 2}
        cy={ASYNC_LANE_Y}
        w={ASYNC_W}
        h={ASYNC_H}
        label="Async Executor"
        rx={ASYNC_H / 2}
      />

      <NodeBox
        cx={RESULT_CX}
        cy={RESULT_CY}
        w={RESULT_W}
        h={RESULT_H}
        label="Result"
        hint="channel"
      />

      <Cylinder
        cx={SQLITE_CX}
        cy={SQLITE_CY}
        rx={SQLITE_RX}
        ry={SQLITE_RY}
        label="SQLite"
      />

      {SYNC_DOTS.map((d) => (
        <circle
          key={`sd-${d}`}
          r="4"
          fill="var(--color-fd-primary)"
          className="ingress-sync"
          style={{ animationDelay: d }}
        />
      ))}

      {ASYNC_DOTS.map((d) => (
        <circle
          key={`ad-${d}`}
          r="4"
          fill="var(--color-fd-primary)"
          className="ingress-async"
          style={{ animationDelay: d }}
        />
      ))}

      {RESULT_DOTS.map((d) => (
        <circle
          key={`rd-${d}`}
          r="4"
          fill="var(--color-fd-primary)"
          className="result-out"
          style={{ animationDelay: d }}
        />
      ))}

      <MotionStyles
        base={`
.taskito-dispatch .ingress-sync,
.taskito-dispatch .ingress-async,
.taskito-dispatch .result-out,
.taskito-dispatch .worker-active,
.taskito-dispatch .worker-ring { opacity: 0; }
.taskito-dispatch .worker-active,
.taskito-dispatch .worker-ring {
  transform-box: fill-box;
  transform-origin: center;
}

.taskito-dispatch .ingress-sync,
.taskito-dispatch .ingress-async,
.taskito-dispatch .result-out {
  offset-rotate: 0deg;
  cx: 0;
  cy: 0;
}
.taskito-dispatch .ingress-sync {
  offset-path: path('M ${SCHED_CX + SCHED_W / 2} ${SCHED_CY - 12} Q ${SCHED_CX + SCHED_W / 2 + 30} ${SYNC_LANE_Y} ${POOL_LEFT - 10} ${SYNC_LANE_Y}');
}
.taskito-dispatch .ingress-async {
  offset-path: path('M ${SCHED_CX + SCHED_W / 2} ${SCHED_CY + 12} Q ${SCHED_CX + SCHED_W / 2 + 30} ${ASYNC_LANE_Y} ${ASYNC_LEFT - 10} ${ASYNC_LANE_Y}');
}
.taskito-dispatch .result-out {
  offset-path: path('M ${RESULT_RIGHT + 4} ${RESULT_CY} L ${SQLITE_CX - SQLITE_RX - 6} ${SQLITE_CY}');
}

@keyframes taskito-dispatch-flow {
  0%   { offset-distance: 0%;   opacity: 0; }
  10%  { opacity: 1; }
  90%  { offset-distance: 100%; opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}
@keyframes taskito-dispatch-worker-active {
  0%, 35%   { opacity: 0; transform: scale(0.6); }
  50%       { opacity: 1; transform: scale(1); }
  85%       { opacity: 1; transform: scale(1); }
  100%      { opacity: 0; transform: scale(0.6); }
}
@keyframes taskito-dispatch-worker-ring {
  0%, 35%   { opacity: 0; transform: scale(0.55); }
  55%       { opacity: 0.55; transform: scale(1.5); }
  100%      { opacity: 0; transform: scale(2.1); }
}
`}
        animations={`
.taskito-dispatch .ingress-sync {
  animation: taskito-dispatch-flow 2.4s linear infinite;
  filter: drop-shadow(0 0 3px var(--color-fd-primary));
}
.taskito-dispatch .ingress-async {
  animation: taskito-dispatch-flow 2.8s linear infinite;
  filter: drop-shadow(0 0 3px var(--color-fd-primary));
}
.taskito-dispatch .result-out {
  animation: taskito-dispatch-flow 2.6s linear infinite;
  filter: drop-shadow(0 0 3px var(--color-fd-primary));
}
.taskito-dispatch .worker-active {
  animation: taskito-dispatch-worker-active var(--worker-duration) ease-in-out infinite;
  animation-delay: var(--worker-delay);
}
.taskito-dispatch .worker-ring {
  animation: taskito-dispatch-worker-ring var(--worker-duration) ease-out infinite;
  animation-delay: var(--worker-delay);
}
`}
      />
    </DiagramFrame>
  );
}

function WorkerCell({ worker }: { worker: Worker }) {
  const half = WORKER_SIZE / 2;
  return (
    <g
      style={
        {
          "--worker-delay": worker.delay,
          "--worker-duration": worker.duration,
        } as CSSProperties
      }
    >
      <rect
        x={worker.cx - half}
        y={worker.cy - half}
        width={WORKER_SIZE}
        height={WORKER_SIZE}
        rx="6"
        fill="var(--color-fd-card)"
        stroke="var(--color-fd-sketch-strong)"
        strokeWidth="2"
        filter={SKETCH_FILTER}
      />
      <circle
        cx={worker.cx}
        cy={worker.cy}
        r="6"
        fill="none"
        stroke="var(--color-fd-primary)"
        strokeWidth="1.4"
        className="worker-ring"
      />
      <circle
        cx={worker.cx}
        cy={worker.cy}
        r="2.5"
        fill="var(--color-fd-muted-foreground)"
        opacity="0.5"
      />
      <circle
        cx={worker.cx}
        cy={worker.cy}
        r="2.5"
        fill="var(--color-fd-primary)"
        className="worker-active"
      />
    </g>
  );
}
