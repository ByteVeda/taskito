import { Arrow, DiagramFrame, MotionStyles, NodeBox } from "./_primitives";

const VIEW_W = 580;
const VIEW_H = 280;
const NODE_W = 116;
const NODE_H = 46;
const ROW_LIVE = 90;
const ROW_FAULT = 200;

type StateData = {
  id: string;
  label: string;
  cx: number;
  cy: number;
  variant?: "primary" | "terminal";
};

const STATES: StateData[] = [
  { id: "pending", label: "Pending", cx: 100, cy: ROW_LIVE },
  {
    id: "running",
    label: "Running",
    cx: 290,
    cy: ROW_LIVE,
    variant: "primary",
  },
  {
    id: "complete",
    label: "Complete",
    cx: 480,
    cy: ROW_LIVE,
    variant: "terminal",
  },
  {
    id: "cancelled",
    label: "Cancelled",
    cx: 100,
    cy: ROW_FAULT,
    variant: "terminal",
  },
  { id: "failed", label: "Failed", cx: 290, cy: ROW_FAULT },
  { id: "dead", label: "Dead", cx: 480, cy: ROW_FAULT, variant: "terminal" },
];

type EdgeData = {
  id: string;
  d: string;
  label?: string;
  labelX?: number;
  labelY?: number;
  anchor?: "start" | "middle" | "end";
  variant?: "muted";
};

const EDGES: EdgeData[] = [
  {
    id: "dequeue",
    d: `M 158 ${ROW_LIVE} L 232 ${ROW_LIVE}`,
    label: "dequeue",
    labelX: 195,
    labelY: ROW_LIVE - 10,
  },
  {
    id: "success",
    d: `M 348 ${ROW_LIVE} L 422 ${ROW_LIVE}`,
    label: "success",
    labelX: 385,
    labelY: ROW_LIVE - 10,
  },
  {
    id: "raise",
    d: `M 290 ${ROW_LIVE + NODE_H / 2} L 290 ${ROW_FAULT - NODE_H / 2}`,
    label: "raise",
    labelX: 302,
    labelY: 145,
    anchor: "start",
  },
  {
    id: "cancel",
    d: `M 100 ${ROW_LIVE + NODE_H / 2} L 100 ${ROW_FAULT - NODE_H / 2}`,
    label: "cancel",
    labelX: 92,
    labelY: 158,
    anchor: "end",
    variant: "muted",
  },
  {
    id: "exhausted",
    d: `M 348 ${ROW_FAULT} L 422 ${ROW_FAULT}`,
    label: "exhausted",
    labelX: 385,
    labelY: ROW_FAULT - 10,
  },
  {
    id: "retry",
    d: `M 232 ${ROW_FAULT - 6} Q 175 ${ROW_FAULT - 4} 158 ${ROW_LIVE + NODE_H / 2 - 2}`,
    label: "retry · backoff",
    labelX: 222,
    labelY: 142,
    anchor: "end",
  },
  {
    id: "retry-dead",
    d: `M 480 ${ROW_FAULT + NODE_H / 2} Q 290 ${VIEW_H - 10} 100 ${ROW_LIVE + NODE_H / 2 + 14}`,
    label: "retry_dead()",
    labelX: 290,
    labelY: VIEW_H - 14,
    variant: "muted",
  },
];

// Composite trajectories — each token traces a coherent story along the arrows.
const PATH_HAPPY = "M 100 90 L 290 90 L 480 90";
const PATH_RETRY =
  "M 100 90 L 290 90 L 290 200 Q 175 196 158 113 L 290 90 L 480 90";
const PATH_DEATH = "M 100 90 L 290 90 L 290 200 L 480 200";

export function JobStateMachine() {
  return (
    <DiagramFrame
      ariaLabel="Job state machine. Pending → Running → Complete on the happy path. Running can drop to Failed; Failed retries to Pending or moves to Dead when retries are exhausted. Pending can also be Cancelled. Dead jobs can be revived via retry_dead()."
      width={VIEW_W}
      height={VIEW_H}
      className="taskito-states"
    >
      {EDGES.map((e) => (
        <Arrow
          key={e.id}
          d={e.d}
          variant={e.variant}
          label={e.label}
          labelX={e.labelX}
          labelY={e.labelY}
          labelAnchor={e.anchor}
        />
      ))}

      {STATES.map((s) => (
        <NodeBox
          key={s.id}
          cx={s.cx}
          cy={s.cy}
          w={NODE_W}
          h={NODE_H}
          label={s.label}
          variant={s.variant}
        />
      ))}

      <circle
        r="5"
        fill="var(--color-fd-primary)"
        className="token token-happy"
      />
      <circle
        r="5"
        fill="var(--color-fd-primary)"
        className="token token-retry"
      />
      <circle
        r="5"
        fill="var(--color-fd-primary)"
        className="token token-death"
      />

      <MotionStyles
        base={`
.taskito-states .token {
  opacity: 0;
  offset-rotate: 0deg;
  cx: 0;
  cy: 0;
}
.taskito-states .token-happy { offset-path: path('${PATH_HAPPY}'); }
.taskito-states .token-retry { offset-path: path('${PATH_RETRY}'); }
.taskito-states .token-death { offset-path: path('${PATH_DEATH}'); }

@keyframes taskito-state-traverse {
  0%   { offset-distance: 0%;   opacity: 0; }
  6%   { opacity: 1; }
  92%  { offset-distance: 100%; opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}
`}
        animations={`
.taskito-states .token-happy {
  animation: taskito-state-traverse 6s cubic-bezier(0.55, 0.05, 0.4, 0.95) infinite;
  filter: drop-shadow(0 0 5px var(--color-fd-primary));
}
.taskito-states .token-retry {
  animation: taskito-state-traverse 11s cubic-bezier(0.55, 0.05, 0.4, 0.95) infinite;
  animation-delay: -2.5s;
  filter: drop-shadow(0 0 5px var(--color-fd-primary));
}
.taskito-states .token-death {
  animation: taskito-state-traverse 8s cubic-bezier(0.55, 0.05, 0.4, 0.95) infinite;
  animation-delay: -4.5s;
  filter: drop-shadow(0 0 5px var(--color-fd-primary));
}
`}
      />
    </DiagramFrame>
  );
}
