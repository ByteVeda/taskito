import {
  Arrow,
  Caption,
  DiagramFrame,
  Lifeline,
  MotionStyles,
  NodeBox,
} from "./_primitives";

const VIEW_W = 760;
const VIEW_H = 380;

type Lane = { id: string; label: string; cx: number };

const LANES: Lane[] = [
  { id: "scheduler", label: "Scheduler", cx: 90 },
  { id: "db", label: "Storage", cx: 240 },
  { id: "rl", label: "RateLimiter", cx: 380 },
  { id: "wp", label: "WorkerPool", cx: 520 },
  { id: "worker", label: "Worker", cx: 660 },
];

const HEADER_Y = 24;
const HEADER_H = 36;
const LIFELINE_TOP = HEADER_Y + HEADER_H + 4;
const LIFELINE_BOTTOM = 358;

type Msg = {
  num: number;
  fromLane: string;
  toLane: string;
  label: string;
  y: number;
  reply?: boolean;
};

const MSGS: Msg[] = [
  {
    num: 1,
    fromLane: "scheduler",
    toLane: "db",
    label: "dequeue_from()",
    y: 88,
  },
  {
    num: 2,
    fromLane: "db",
    toLane: "scheduler",
    label: "pending job",
    y: 124,
    reply: true,
  },
  { num: 3, fromLane: "scheduler", toLane: "rl", label: "check(task)", y: 160 },
  {
    num: 4,
    fromLane: "rl",
    toLane: "scheduler",
    label: "ok",
    y: 196,
    reply: true,
  },
  {
    num: 5,
    fromLane: "scheduler",
    toLane: "wp",
    label: "mpsc.send(job)",
    y: 232,
  },
  { num: 6, fromLane: "wp", toLane: "worker", label: "execute()", y: 268 },
  {
    num: 7,
    fromLane: "worker",
    toLane: "scheduler",
    label: "result",
    y: 304,
    reply: true,
  },
  {
    num: 8,
    fromLane: "scheduler",
    toLane: "db",
    label: "handle_result()",
    y: 340,
  },
];

const TOTAL_DURATION = 14;
const SLOT_PERCENT = 8;
const TRAVEL_PERCENT = 6.5;
const FADE_IN_PERCENT = 0.5;
const FADE_OUT_PERCENT = TRAVEL_PERCENT + 0.5;

function laneCx(id: string): number {
  const lane = LANES.find((l) => l.id === id);
  if (!lane) throw new Error(`unknown lane: ${id}`);
  return lane.cx;
}

export function DispatchSequence() {
  return (
    <DiagramFrame
      ariaLabel="Dispatch sequence diagram. Numbered messages flow between Scheduler, Storage, RateLimiter, Worker Pool, and Worker — including the rate-limited fallback branch."
      width={VIEW_W}
      height={VIEW_H}
      className="taskito-seq"
    >
      {LANES.map((lane) => (
        <g key={lane.id}>
          <NodeBox
            cx={lane.cx}
            cy={HEADER_Y + HEADER_H / 2}
            w={120}
            h={HEADER_H}
            label={lane.label}
          />
          <Lifeline x={lane.cx} y1={LIFELINE_TOP} y2={LIFELINE_BOTTOM} />
        </g>
      ))}

      {MSGS.map((msg) => {
        const x1 = laneCx(msg.fromLane);
        const x2 = laneCx(msg.toLane);
        const dir = x2 > x1 ? 1 : -1;
        const startX = x1 + dir * 6;
        const endX = x2 - dir * 6;
        return (
          <g key={msg.num}>
            <Arrow
              d={`M ${startX} ${msg.y} L ${endX} ${msg.y}`}
              variant={msg.reply ? "muted" : "default"}
            />
            <text
              x={(startX + endX) / 2}
              y={msg.y - 6}
              textAnchor="middle"
              fill="var(--color-fd-foreground)"
              fontSize="11"
              fontFamily='var(--font-mono), "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace'
            >
              <tspan fill="var(--color-fd-primary)" fontWeight="700">
                {`${msg.num} `}
              </tspan>
              {msg.label}
            </text>
          </g>
        );
      })}

      <Caption
        x={388}
        y={208}
        text="alt: rate-limited → reschedule +1s"
        anchor="start"
        size={9}
      />

      {/* animated tokens — one per message, staggered to fire in order */}
      {MSGS.map((msg, i) => (
        <circle
          key={`tok-${msg.num}`}
          r="6"
          fill="var(--color-fd-primary)"
          className={`tok tok-${msg.num}`}
          style={{
            animationDelay: `${(i * TOTAL_DURATION * SLOT_PERCENT) / 100 - TOTAL_DURATION}s`,
          }}
        />
      ))}

      <MotionStyles
        base={`
.taskito-seq .tok { opacity: 0; }
${MSGS.map((m) => keyframeFor(m)).join("\n")}
`}
        animations={`
${MSGS.map(
  (m) => `.taskito-seq .tok-${m.num} {
  animation: taskito-seq-msg-${m.num} ${TOTAL_DURATION}s linear infinite;
  filter: drop-shadow(0 0 6px var(--color-fd-primary));
}`,
).join("\n")}
`}
      />
    </DiagramFrame>
  );
}

function keyframeFor(msg: Msg): string {
  const startX = laneCx(msg.fromLane);
  const endX = laneCx(msg.toLane);
  return `
@keyframes taskito-seq-msg-${msg.num} {
  0%                       { cx: ${startX}px; cy: ${msg.y}px; opacity: 0; }
  ${FADE_IN_PERCENT}%      { cx: ${startX}px; cy: ${msg.y}px; opacity: 1; }
  ${TRAVEL_PERCENT}%       { cx: ${endX}px;   cy: ${msg.y}px; opacity: 1; }
  ${FADE_OUT_PERCENT}%     { cx: ${endX}px;   cy: ${msg.y}px; opacity: 0; }
  ${SLOT_PERCENT}%         { cx: ${startX}px; cy: ${msg.y}px; opacity: 0; }
  100%                     { cx: ${startX}px; cy: ${msg.y}px; opacity: 0; }
}`;
}
