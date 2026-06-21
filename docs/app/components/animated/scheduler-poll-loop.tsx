import {
  Arrow,
  Caption,
  DiagramFrame,
  MotionStyles,
  NodeBox,
  SKETCH_FILTER,
} from "./_primitives";

const VIEW_W = 760;
const VIEW_H = 380;
const CENTER_X = 510;
const CENTER_Y = 200;
const ORBIT_R = 120;

type LoopNode = {
  id: string;
  label: string;
  hint?: string;
  cx: number;
  cy: number;
  shape: "rect" | "diamond" | "pill";
  variant?: "primary";
};

const LOOP_NODES: LoopNode[] = [
  {
    id: "tick",
    label: "loop tick",
    cx: CENTER_X,
    cy: CENTER_Y - ORBIT_R,
    shape: "pill",
  },
  {
    id: "sleep",
    label: "sleep",
    hint: "50ms",
    cx: CENTER_X + ORBIT_R,
    cy: CENTER_Y,
    shape: "rect",
  },
  {
    id: "dispatch",
    label: "try_dispatch()",
    cx: CENTER_X,
    cy: CENTER_Y + ORBIT_R,
    shape: "rect",
    variant: "primary",
  },
  {
    id: "periodic",
    label: "iteration % N",
    cx: CENTER_X - ORBIT_R,
    cy: CENTER_Y,
    shape: "diamond",
  },
];

type Branch = {
  id: string;
  label: string;
  every: string;
  cx: number;
  cy: number;
  /** Where the arrow exits the diamond. */
  startX: number;
  startY: number;
  pulseClass: string;
};

// Diamond geometry: center at (CENTER_X - ORBIT_R, CENTER_Y) = (390, 200).
// halfX=64, halfY=40 → vertices: top (390,160), right (454,200), bottom
// (390,240), left (326,200). Each branch arrow exits from a distinct point
// on the diamond's left half so arrows are visibly anchored to the shape.
const DIAMOND_CX = CENTER_X - ORBIT_R;
const DIAMOND_TOP_LEFT = { x: DIAMOND_CX - 32, y: CENTER_Y - 20 };
const DIAMOND_LEFT = { x: DIAMOND_CX - 64, y: CENTER_Y };
const DIAMOND_BOTTOM_LEFT = { x: DIAMOND_CX - 32, y: CENTER_Y + 20 };

const BRANCHES: Branch[] = [
  {
    id: "checkp",
    label: "check_periodic()",
    every: "every ~60",
    cx: 160,
    cy: 100,
    startX: DIAMOND_TOP_LEFT.x,
    startY: DIAMOND_TOP_LEFT.y,
    pulseClass: "pulse-fast",
  },
  {
    id: "reap",
    label: "reap_stale()",
    every: "every ~100",
    cx: 130,
    cy: 200,
    startX: DIAMOND_LEFT.x,
    startY: DIAMOND_LEFT.y,
    pulseClass: "pulse-mid",
  },
  {
    id: "cleanup",
    label: "auto_cleanup()",
    every: "every ~1200",
    cx: 160,
    cy: 300,
    startX: DIAMOND_BOTTOM_LEFT.x,
    startY: DIAMOND_BOTTOM_LEFT.y,
    pulseClass: "pulse-slow",
  },
];

export function SchedulerPollLoop() {
  return (
    <DiagramFrame
      ariaLabel="Scheduler poll loop. A four-node ring (loop tick → sleep 50ms → try_dispatch → iteration check) with three branch tasks (check_periodic, reap_stale, auto_cleanup) firing at coprime multiples."
      width={VIEW_W}
      height={VIEW_H}
      className="taskito-poll"
    >
      <circle
        cx={CENTER_X}
        cy={CENTER_Y}
        r={ORBIT_R}
        fill="none"
        stroke="var(--color-fd-sketch-accent)"
        strokeWidth="1.8"
        strokeDasharray="3 7"
        opacity="0.55"
        filter={SKETCH_FILTER}
      />

      {[45, 135, 225, 315].map((angle) => (
        <OrbitTick key={angle} angle={angle} />
      ))}

      {LOOP_NODES.map((node) => (
        <LoopNodeShape key={node.id} node={node} />
      ))}

      {BRANCHES.map((b) => {
        const endX = b.cx + 80;
        const endY = b.cy;
        const midX = (b.startX + endX) / 2;
        const midY = (b.startY + endY) / 2;
        return (
          <g key={b.id}>
            <Arrow
              d={`M ${b.startX} ${b.startY} Q ${midX} ${midY} ${endX} ${endY}`}
              variant="muted"
            />
            <Caption x={midX} y={midY - 8} text={b.every} size={10} />
            <NodeBox
              cx={b.cx}
              cy={b.cy}
              w={160}
              h={40}
              label={b.label}
              variant="muted"
            />
            <circle
              cx={b.cx + 80 - 12}
              cy={b.cy - 20 + 8}
              r="3.5"
              fill="var(--color-fd-primary)"
              className={b.pulseClass}
            />
          </g>
        );
      })}

      <circle
        cx={CENTER_X}
        cy={CENTER_Y - ORBIT_R}
        r="6"
        fill="var(--color-fd-primary)"
        className="orbit-dot"
      />

      <MotionStyles
        base={`
.taskito-poll .orbit-dot { opacity: 0; }
.taskito-poll .pulse-fast,
.taskito-poll .pulse-mid,
.taskito-poll .pulse-slow { opacity: 0; }

@keyframes taskito-poll-orbit {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes taskito-poll-pulse {
  0%, 100% { opacity: 0; }
  50%      { opacity: 1; }
}
`}
        animations={`
.taskito-poll .orbit-dot {
  opacity: 1;
  transform-box: view-box;
  transform-origin: ${CENTER_X}px ${CENTER_Y}px;
  animation: taskito-poll-orbit 4s linear infinite;
  filter: drop-shadow(0 0 6px var(--color-fd-primary));
}
.taskito-poll .pulse-fast {
  animation: taskito-poll-pulse 2.4s ease-in-out infinite;
}
.taskito-poll .pulse-mid {
  animation: taskito-poll-pulse 4s ease-in-out infinite;
  animation-delay: -1s;
}
.taskito-poll .pulse-slow {
  animation: taskito-poll-pulse 6s ease-in-out infinite;
  animation-delay: -3s;
}
`}
      />
    </DiagramFrame>
  );
}

function LoopNodeShape({ node }: { node: LoopNode }) {
  if (node.shape === "diamond") {
    const halfX = 64;
    const halfY = 40;
    return (
      <g>
        <polygon
          points={`${node.cx},${node.cy - halfY} ${node.cx + halfX},${node.cy} ${node.cx},${node.cy + halfY} ${node.cx - halfX},${node.cy}`}
          fill="var(--color-fd-card)"
          stroke="var(--color-fd-sketch-strong)"
          strokeWidth="2"
          filter={SKETCH_FILTER}
        />
        <text
          x={node.cx}
          y={node.cy + 4}
          textAnchor="middle"
          fill="var(--color-fd-foreground)"
          fontSize="12"
          fontWeight="600"
        >
          {node.label}
        </text>
      </g>
    );
  }

  if (node.shape === "pill") {
    return (
      <NodeBox
        cx={node.cx}
        cy={node.cy}
        w={140}
        h={42}
        label={node.label}
        rx={21}
      />
    );
  }

  return (
    <NodeBox
      cx={node.cx}
      cy={node.cy}
      w={160}
      h={50}
      label={node.label}
      hint={node.hint}
      variant={node.variant}
    />
  );
}

function OrbitTick({ angle }: { angle: number }) {
  const rad = (angle * Math.PI) / 180;
  const x = CENTER_X + ORBIT_R * Math.cos(rad);
  const y = CENTER_Y + ORBIT_R * Math.sin(rad);
  const tangent = angle + 90;
  return (
    <g transform={`translate(${x} ${y}) rotate(${tangent})`} opacity="0.5">
      <path
        d="M -4 -3 L 0 0 L -4 3"
        fill="none"
        stroke="var(--color-fd-sketch-accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}
