import {
  Arrow,
  DiagramFrame,
  MotionStyles,
  NodeBox,
  Panel,
} from "./_primitives";

const VIEW_W = 640;
const VIEW_H = 296;

const PANELS = [
  { id: "python", label: "python layer", y: 24, h: 76, cy: 62 },
  { id: "rust", label: "rust core", y: 110, h: 76, cy: 148 },
  { id: "storage", label: "storage", y: 196, h: 76, cy: 234 },
] as const;

type NodeData = {
  id: string;
  label: string;
  hint?: string;
  cx: number;
  cy: number;
  variant?: "primary";
};

const NODES: NodeData[] = [
  { id: "queue", label: "Queue", hint: ".delay()", cx: 150, cy: 62 },
  { id: "task", label: "@task fn", hint: "Python", cx: 490, cy: 62 },
  { id: "pyqueue", label: "PyQueue", hint: "PyO3", cx: 150, cy: 148 },
  {
    id: "scheduler",
    label: "Scheduler",
    hint: "Tokio · 50ms",
    cx: 320,
    cy: 148,
    variant: "primary",
  },
  {
    id: "workerpool",
    label: "Worker Pool",
    hint: "Rust threads",
    cx: 490,
    cy: 148,
  },
  { id: "sqlite", label: "SQLite", hint: "default", cx: 260, cy: 234 },
  { id: "postgres", label: "PostgreSQL", hint: "scale-out", cx: 420, cy: 234 },
];

const ARROWS = [
  { id: "enqueue", d: "M 150 85 L 150 125" },
  { id: "insert", d: "M 205 148 L 265 148" },
  { id: "dispatch", d: "M 375 148 L 435 148" },
  { id: "gil", d: "M 490 125 L 490 85" },
  {
    id: "persist",
    d: "M 320 172 Q 320 188 340 200",
    variant: "muted" as const,
  },
];

export function ArchitectureStack() {
  return (
    <DiagramFrame
      ariaLabel="Three-layer architecture: Python on top, Rust core in the middle, Storage at the bottom. Jobs flow from Queue to PyQueue to the Scheduler to Storage; workers acquire the GIL to call the Python task function."
      width={VIEW_W}
      height={VIEW_H}
      className="taskito-stack"
    >
      {PANELS.map((p) => (
        <Panel
          key={p.id}
          x={20}
          y={p.y}
          w={VIEW_W - 40}
          h={p.h}
          label={p.label}
        />
      ))}

      {ARROWS.map((a) => (
        <Arrow key={a.id} d={a.d} variant={a.variant} />
      ))}

      {NODES.map((n) => (
        <NodeBox
          key={n.id}
          cx={n.cx}
          cy={n.cy}
          label={n.label}
          hint={n.hint}
          variant={n.variant}
        />
      ))}

      <text
        x={490}
        y={108}
        textAnchor="end"
        fill="var(--color-fd-foreground)"
        fontSize="11"
        fontFamily='var(--font-mono), "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace'
        fontWeight="500"
        opacity="0.9"
      >
        acquire GIL
      </text>

      <circle r="5" fill="var(--color-fd-primary)" className="token ingress" />
      <circle r="5" fill="var(--color-fd-primary)" className="token execute" />

      <MotionStyles
        base={`
.taskito-stack .token {
  opacity: 0;
  offset-rotate: 0deg;
  cx: 0;
  cy: 0;
}
.taskito-stack .ingress {
  offset-path: path('M 150 62 L 150 148 L 320 148 Q 320 188 340 200');
}
.taskito-stack .execute {
  offset-path: path('M 320 148 L 490 148 L 490 62');
}

@keyframes taskito-stack-traverse {
  0%   { offset-distance: 0%;   opacity: 0; }
  6%   { opacity: 1; }
  92%  { offset-distance: 100%; opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}
`}
        animations={`
.taskito-stack .ingress {
  animation: taskito-stack-traverse 7s cubic-bezier(0.55, 0.05, 0.4, 0.95) infinite;
  filter: drop-shadow(0 0 5px var(--color-fd-primary));
}
.taskito-stack .execute {
  animation: taskito-stack-traverse 7s cubic-bezier(0.55, 0.05, 0.4, 0.95) infinite;
  animation-delay: -3.5s;
  filter: drop-shadow(0 0 5px var(--color-fd-primary));
}
`}
      />
    </DiagramFrame>
  );
}
