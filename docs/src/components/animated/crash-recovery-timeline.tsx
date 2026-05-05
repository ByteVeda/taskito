import {
  Arrow,
  Caption,
  DiagramFrame,
  MotionStyles,
  NodeBox,
  SKETCH_FILTER,
} from "./_primitives";

const VIEW_W = 760;
const VIEW_H = 260;
const TRACK_Y = 150;
const TRACK_LEFT = 50;
const TRACK_RIGHT = 730;
const WORKER_Y = 60;

type Marker = {
  id: string;
  x: number;
  time: string;
  label: string;
  variant?: "primary" | "danger" | "success";
};

const MARKERS: Marker[] = [
  { id: "enqueue", x: 80, time: "T=0", label: "enqueue", variant: "primary" },
  {
    id: "dispatch",
    x: 170,
    time: "T=1s",
    label: "dispatch",
    variant: "primary",
  },
  { id: "crash", x: 250, time: "T=5s", label: "crash", variant: "danger" },
  {
    id: "reap",
    x: 510,
    time: "T=300s",
    label: "reap_stale",
    variant: "primary",
  },
  { id: "retry", x: 600, time: "T=301s", label: "retry", variant: "primary" },
  { id: "done", x: 690, time: "T=302s", label: "complete", variant: "success" },
];

const POLLING_LEFT = 280;
const POLLING_RIGHT = 480;

export function CrashRecoveryTimeline() {
  return (
    <DiagramFrame
      ariaLabel="Crash recovery timeline. A job is enqueued at T=0, dispatched at T=1s; the worker crashes at T=5s. The scheduler keeps polling every 50ms. At T=300s reap_stale_jobs() detects the abandoned job and schedules a retry which completes by T=302s."
      width={VIEW_W}
      height={VIEW_H}
      className="taskito-crash"
    >
      {/* Worker boxes (above timeline) */}
      <NodeBox cx={170} cy={WORKER_Y} w={120} h={40} label="Worker A" />
      <NodeBox cx={600} cy={WORKER_Y} w={120} h={40} label="Worker B" />

      {/* dispatch arrows from timeline up to workers */}
      <Arrow d={`M 170 ${TRACK_Y - 8} L 170 ${WORKER_Y + 22}`} />
      <Arrow d={`M 600 ${TRACK_Y - 8} L 600 ${WORKER_Y + 22}`} />

      {/* horizontal timeline */}
      <line
        x1={TRACK_LEFT}
        y1={TRACK_Y}
        x2={TRACK_RIGHT}
        y2={TRACK_Y}
        stroke="var(--color-fd-sketch-accent)"
        strokeWidth="2"
        strokeDasharray="2 5"
        strokeLinecap="round"
        markerEnd="url(#taskito-sketch-arrow)"
        filter={SKETCH_FILTER}
      />
      <Caption x={TRACK_RIGHT + 4} y={TRACK_Y + 4} text="time" anchor="start" />

      {/* polling-ticks region between crash and reap */}
      <PollingRegion x1={POLLING_LEFT} x2={POLLING_RIGHT} y={TRACK_Y} />

      {/* polling annotation above the ticks (between crash and reap markers) */}
      <Caption
        x={(POLLING_LEFT + POLLING_RIGHT) / 2}
        y={TRACK_Y - 14}
        text="polls every 50ms · job sits in 'running'"
        size={10}
      />

      {MARKERS.map((m) => (
        <MarkerPin key={m.id} marker={m} />
      ))}

      {/* crash burst at worker A location */}
      <CrashBurst cx={170} cy={WORKER_Y} />

      {/* reap glow ring at T=300s marker */}
      <circle
        cx={510}
        cy={TRACK_Y}
        r="14"
        fill="none"
        stroke="var(--color-fd-primary)"
        strokeWidth="1.6"
        className="reap-ring"
      />

      {/* job dot animating across the timeline */}
      <circle r="5.5" fill="var(--color-fd-primary)" className="job-dot" />

      <MotionStyles
        base={`
.taskito-crash .job-dot,
.taskito-crash .crash-burst,
.taskito-crash .reap-ring,
.taskito-crash .polling-tick { opacity: 0; }
.taskito-crash .reap-ring {
  transform-box: fill-box;
  transform-origin: center;
}

.taskito-crash .job-dot {
  offset-path: path('M 80 ${TRACK_Y} L 170 ${TRACK_Y} L 170 ${WORKER_Y + 22} L 170 ${TRACK_Y} L 510 ${TRACK_Y} L 600 ${TRACK_Y} L 600 ${WORKER_Y + 22} L 600 ${TRACK_Y} L 690 ${TRACK_Y}');
  offset-rotate: 0deg;
  cx: 0;
  cy: 0;
}
@keyframes taskito-crash-job {
  0%   { offset-distance: 0%;    opacity: 0; }
  3%   { opacity: 1; }
  14%  { offset-distance: 10%;   opacity: 1; }
  18%  { offset-distance: 18%;   opacity: 1; }
  24%  { offset-distance: 18%;   opacity: 0; }
  60%  { offset-distance: 64%;   opacity: 0; }
  66%  { offset-distance: 64%;   opacity: 1; }
  76%  { offset-distance: 74.4%; opacity: 1; }
  82%  { offset-distance: 82.1%; opacity: 1; }
  88%  { offset-distance: 89.8%; opacity: 1; }
  94%  { offset-distance: 100%;  opacity: 1; }
  98%  { opacity: 0; }
  100% { offset-distance: 100%;  opacity: 0; }
}
@keyframes taskito-crash-burst {
  0%, 26%   { opacity: 0; transform: scale(0.5); }
  30%       { opacity: 1; transform: scale(1.15); }
  60%       { opacity: 0.5; transform: scale(1); }
  100%      { opacity: 0; transform: scale(0.5); }
}
@keyframes taskito-crash-reap {
  0%, 60%   { opacity: 0; transform: scale(0.5); }
  68%       { opacity: 0.85; transform: scale(1); }
  82%       { opacity: 0; transform: scale(2.4); }
  100%      { opacity: 0; transform: scale(0.5); }
}
@keyframes taskito-crash-tick {
  0%, 30%   { opacity: 0.15; }
  50%       { opacity: 0.85; }
  70%, 100% { opacity: 0.15; }
}
`}
        animations={`
.taskito-crash .job-dot {
  animation: taskito-crash-job 14s cubic-bezier(0.55, 0.05, 0.4, 0.95) infinite;
  filter: drop-shadow(0 0 6px var(--color-fd-primary));
}
.taskito-crash .crash-burst {
  animation: taskito-crash-burst 14s ease-in-out infinite;
}
.taskito-crash .reap-ring {
  animation: taskito-crash-reap 14s ease-out infinite;
}
.taskito-crash .polling-tick-0 { animation: taskito-crash-tick 1.4s ease-in-out infinite; animation-delay: -0.0s; }
.taskito-crash .polling-tick-1 { animation: taskito-crash-tick 1.4s ease-in-out infinite; animation-delay: -0.35s; }
.taskito-crash .polling-tick-2 { animation: taskito-crash-tick 1.4s ease-in-out infinite; animation-delay: -0.7s; }
.taskito-crash .polling-tick-3 { animation: taskito-crash-tick 1.4s ease-in-out infinite; animation-delay: -1.05s; }
`}
      />
    </DiagramFrame>
  );
}

function MarkerPin({ marker }: { marker: Marker }) {
  const color =
    marker.variant === "danger"
      ? "var(--color-fd-muted-foreground)"
      : marker.variant === "success" || marker.variant === "primary"
        ? "var(--color-fd-primary)"
        : "var(--color-fd-muted-foreground)";
  return (
    <g>
      <line
        x1={marker.x}
        y1={TRACK_Y - 8}
        x2={marker.x}
        y2={TRACK_Y + 8}
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx={marker.x} cy={TRACK_Y} r="3.5" fill={color} />
      <text
        x={marker.x}
        y={TRACK_Y + 22}
        textAnchor="middle"
        fill="var(--color-fd-muted-foreground)"
        fontSize="10"
        fontFamily='var(--font-mono), "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace'
        opacity="0.85"
      >
        {marker.time}
      </text>
      <text
        x={marker.x}
        y={TRACK_Y + 38}
        textAnchor="middle"
        fill="var(--color-fd-foreground)"
        fontSize="11"
        fontWeight="500"
      >
        {marker.label}
      </text>
    </g>
  );
}

function CrashBurst({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g
      className="crash-burst"
      style={{
        transformBox: "fill-box",
        transformOrigin: "center",
        transform: `translate(${cx}px, ${cy}px)`,
      }}
    >
      <line
        x1={-10}
        y1={-10}
        x2={10}
        y2={10}
        stroke="var(--color-fd-muted-foreground)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1={10}
        y1={-10}
        x2={-10}
        y2={10}
        stroke="var(--color-fd-muted-foreground)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle
        r="18"
        fill="none"
        stroke="var(--color-fd-muted-foreground)"
        strokeWidth="1.4"
        strokeDasharray="2 3"
        opacity="0.6"
      />
    </g>
  );
}

function PollingRegion({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  const count = Math.floor((x2 - x1) / 14);
  return (
    <g>
      {Array.from({ length: count }, (_, i) => (
        <line
          // biome-ignore lint/suspicious/noArrayIndexKey: stable index for deterministic stagger
          key={i}
          x1={x1 + i * 14 + 7}
          y1={y - 4}
          x2={x1 + i * 14 + 7}
          y2={y + 4}
          stroke="var(--color-fd-muted-foreground)"
          strokeWidth="1.4"
          opacity="0.45"
          className={`polling-tick polling-tick-${i % 4}`}
        />
      ))}
    </g>
  );
}
