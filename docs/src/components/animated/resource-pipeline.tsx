import {
  Arrow,
  Caption,
  Cylinder,
  DiagramFrame,
  MotionStyles,
  NodeBox,
  Panel,
} from "./_primitives";

const VIEW_W = 820;
const VIEW_H = 380;

const ENQ_X = 20;
const ENQ_Y = 24;
const ENQ_W = 340;
const ENQ_H = 332;
const ENQ_CX = ENQ_X + ENQ_W / 2; // 190

const WRK_X = 400;
const WRK_Y = 24;
const WRK_W = 400;
const WRK_H = 332;
const WRK_CX = WRK_X + WRK_W / 2; // 600

const QUEUE_CX = 380;
const QUEUE_CY = 196;
const QUEUE_RX = 24;
const QUEUE_RY = 16;

const ROW_TOP = 78;
const ROW_MID = 152;
const ROW_PROXY = 232;
const ROW_FN = 304;

type NodeData = {
  id: string;
  label: string;
  hint?: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  variant?: "primary" | "muted";
};

const ENQ_NODES: NodeData[] = [
  {
    id: "args",
    label: "Task arguments",
    cx: ENQ_CX,
    cy: ROW_TOP,
    w: 200,
    h: 40,
  },
  {
    id: "ic",
    label: "ArgumentInterceptor",
    hint: "PASS · CONVERT · REDIRECT · PROXY",
    cx: ENQ_CX,
    cy: ROW_MID,
    w: 260,
    h: 50,
    variant: "primary",
  },
  {
    id: "px",
    label: "ProxyHandler",
    hint: ".deconstruct()",
    cx: ENQ_CX,
    cy: ROW_PROXY,
    w: 200,
    h: 42,
  },
  {
    id: "ser",
    label: "Serializer",
    hint: "bytes",
    cx: ENQ_CX,
    cy: ROW_FN,
    w: 170,
    h: 42,
  },
];

const WORKER_NODES: NodeData[] = [
  { id: "de", label: "Deserialize", cx: WRK_CX, cy: ROW_TOP, w: 170, h: 40 },
  {
    id: "rc",
    label: "reconstruct_args()",
    cx: WRK_CX,
    cy: ROW_MID,
    w: 220,
    h: 46,
  },
  {
    id: "pxr",
    label: "ProxyHandler",
    hint: ".reconstruct()",
    cx: 510,
    cy: ROW_PROXY,
    w: 140,
    h: 42,
    variant: "muted",
  },
  {
    id: "rr",
    label: "ResourceRuntime",
    hint: "inject()",
    cx: 690,
    cy: ROW_PROXY,
    w: 140,
    h: 42,
    variant: "muted",
  },
  {
    id: "fn",
    label: "Task function",
    hint: "f(**args)",
    cx: WRK_CX,
    cy: ROW_FN,
    w: 180,
    h: 50,
    variant: "primary",
  },
];

export function ResourcePipeline() {
  return (
    <DiagramFrame
      ariaLabel="Resource pipeline. On enqueue: arguments flow through ArgumentInterceptor, optionally through a ProxyHandler, into the Serializer, into the Queue. On worker dispatch: payloads are deserialized, reconstructed, and reconstituted with proxies and resource injection before the task function runs."
      width={VIEW_W}
      height={VIEW_H}
      className="taskito-resources"
    >
      <Panel x={ENQ_X} y={ENQ_Y} w={ENQ_W} h={ENQ_H} label="enqueue()" />
      <Panel x={WRK_X} y={WRK_Y} w={WRK_W} h={WRK_H} label="worker dispatch" />

      {/* ENQ vertical chain: Args → IC → PX → SER */}
      <Arrow d={`M ${ENQ_CX} ${ROW_TOP + 20} L ${ENQ_CX} ${ROW_MID - 25}`} />
      <Arrow
        d={`M ${ENQ_CX} ${ROW_MID + 25} L ${ENQ_CX} ${ROW_PROXY - 21}`}
        label="PROXY"
        labelX={ENQ_CX + 12}
        labelY={ROW_MID + 50}
        labelAnchor="start"
      />
      <Arrow d={`M ${ENQ_CX} ${ROW_PROXY + 21} L ${ENQ_CX} ${ROW_FN - 21}`} />

      {/* PASS bypass */}
      <Arrow
        d={`M ${ENQ_CX - 130} ${ROW_MID} Q ${ENQ_X + 16} ${ROW_MID} ${ENQ_X + 16} ${ROW_FN} Q ${ENQ_X + 16} ${ROW_FN} ${ENQ_CX - 85} ${ROW_FN}`}
        variant="muted"
        label="PASS"
        labelX={ENQ_X + 24}
        labelY={ROW_PROXY + 4}
        labelAnchor="start"
      />

      {/* SER → Queue → DE */}
      <Arrow
        d={`M ${ENQ_CX + 85} ${ROW_FN} Q ${(ENQ_CX + QUEUE_CX) / 2} ${ROW_FN} ${QUEUE_CX} ${QUEUE_CY + QUEUE_RY + 4}`}
      />
      <Arrow
        d={`M ${QUEUE_CX} ${QUEUE_CY - QUEUE_RY - 4} Q ${QUEUE_CX} ${ROW_TOP} ${WRK_CX - 85} ${ROW_TOP}`}
      />

      {/* WRK chain: DE → RC → FN */}
      <Arrow d={`M ${WRK_CX} ${ROW_TOP + 20} L ${WRK_CX} ${ROW_MID - 23}`} />
      <Arrow d={`M ${WRK_CX} ${ROW_MID + 23} L ${WRK_CX} ${ROW_FN - 25}`} />

      {/* PXR → FN (diagonal down-right) */}
      <Arrow
        d={`M 510 ${ROW_PROXY + 21} Q 510 ${ROW_PROXY + 50} ${WRK_CX - 50} ${ROW_FN - 21}`}
        variant="muted"
      />
      {/* RR → FN (diagonal down-left) */}
      <Arrow
        d={`M 690 ${ROW_PROXY + 21} Q 690 ${ROW_PROXY + 50} ${WRK_CX + 50} ${ROW_FN - 21}`}
        variant="muted"
      />

      <Cylinder
        cx={QUEUE_CX}
        cy={QUEUE_CY}
        rx={QUEUE_RX}
        ry={QUEUE_RY}
        label="Queue"
      />
      <Caption
        x={QUEUE_CX}
        y={QUEUE_CY - QUEUE_RY - 14}
        text="bytes"
        size={9}
      />

      {ENQ_NODES.map((n) => (
        <NodeBox key={n.id} {...n} />
      ))}
      {WORKER_NODES.map((n) => (
        <NodeBox key={n.id} {...n} />
      ))}

      <circle
        r="5"
        fill="var(--color-fd-primary)"
        className="token token-pass"
      />
      <circle
        r="5"
        fill="var(--color-fd-primary)"
        className="token token-proxy"
      />

      <MotionStyles
        base={`
.taskito-resources .token {
  opacity: 0;
  offset-rotate: 0deg;
  cx: 0;
  cy: 0;
}
.taskito-resources .token-pass {
  offset-path: path('M ${ENQ_CX} ${ROW_TOP} L ${ENQ_CX} ${ROW_MID} Q ${ENQ_X + 16} ${ROW_MID} ${ENQ_X + 16} ${ROW_FN} Q ${ENQ_X + 16} ${ROW_FN} ${ENQ_CX} ${ROW_FN} Q ${(ENQ_CX + QUEUE_CX) / 2} ${ROW_FN} ${QUEUE_CX} ${QUEUE_CY} Q ${QUEUE_CX} ${ROW_TOP} ${WRK_CX} ${ROW_TOP} L ${WRK_CX} ${ROW_MID} L ${WRK_CX} ${ROW_FN}');
}
.taskito-resources .token-proxy {
  offset-path: path('M ${ENQ_CX} ${ROW_TOP} L ${ENQ_CX} ${ROW_MID} L ${ENQ_CX} ${ROW_PROXY} L ${ENQ_CX} ${ROW_FN} Q ${(ENQ_CX + QUEUE_CX) / 2} ${ROW_FN} ${QUEUE_CX} ${QUEUE_CY} Q ${QUEUE_CX} ${ROW_TOP} ${WRK_CX} ${ROW_TOP} L ${WRK_CX} ${ROW_MID} L ${WRK_CX} ${ROW_FN}');
}

@keyframes taskito-resources-traverse {
  0%   { offset-distance: 0%;   opacity: 0; }
  6%   { opacity: 1; }
  92%  { offset-distance: 100%; opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}
`}
        animations={`
.taskito-resources .token-pass {
  animation: taskito-resources-traverse 9s cubic-bezier(0.55, 0.05, 0.4, 0.95) infinite;
  filter: drop-shadow(0 0 5px var(--color-fd-primary));
}
.taskito-resources .token-proxy {
  animation: taskito-resources-traverse 9s cubic-bezier(0.55, 0.05, 0.4, 0.95) infinite;
  animation-delay: -4.5s;
  filter: drop-shadow(0 0 5px var(--color-fd-primary));
}
`}
      />
    </DiagramFrame>
  );
}
