// Job state machine — faithful port of arch.js `lifecycle()` (static semantic-color
// SVG). `architecture/job-lifecycle.mdx`.

const ARROWS = [
  { id: "lcar", stroke: "var(--line3)", w: 1.6 },
  { id: "lcok", stroke: "var(--grn)", w: 1.8 },
  { id: "lcwarn", stroke: "var(--amber)", w: 1.8 },
  { id: "lcind", stroke: "var(--indigo)", w: 1.8 },
];

function LcNode({
  x,
  y,
  label,
  code,
  cls,
}: {
  x: number;
  y: number;
  label: string;
  code: string;
  cls: string;
}) {
  return (
    <g className={`lc-node ${cls}`}>
      <rect x={x} y={y} width={200} height={64} rx={14} />
      <circle className="lc-sd" cx={x + 22} cy={y + 32} r={5} />
      <text x={x + 40} y={y + 30} className="lc-nt">
        {label}
      </text>
      <text x={x + 40} y={y + 48} className="lc-nc">
        status {code}
      </text>
    </g>
  );
}

export function JobStateMachine() {
  return (
    <div className="lc">
      <svg
        viewBox="0 0 920 392"
        role="img"
        aria-label="Job state machine: Pending dispatches to Running, which succeeds to Complete or errors to Failed. Failed retries to Pending or, when exhausted, moves to Dead. Pending can be Cancelled before execution."
      >
        <defs>
          {ARROWS.map((a) => (
            <marker
              key={a.id}
              id={a.id}
              viewBox="0 0 10 10"
              refX={8}
              refY={5}
              markerWidth={7}
              markerHeight={7}
              orient="auto"
            >
              <path
                d="M1 1 L9 5 L1 9"
                fill="none"
                stroke={a.stroke}
                strokeWidth={a.w}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>
          ))}
        </defs>

        <path
          d="M250 84 L356 84"
          fill="none"
          stroke="var(--line3)"
          strokeWidth={2}
          strokeDasharray="2 7"
          strokeLinecap="round"
          markerEnd="url(#lcind)"
        />
        <text x={303} y={74} textAnchor="middle" className="lc-elabel">
          dispatch
        </text>
        <path
          d="M566 84 L672 84"
          fill="none"
          stroke="var(--grn)"
          strokeWidth={2}
          strokeDasharray="2 7"
          strokeLinecap="round"
          markerEnd="url(#lcok)"
        />
        <text
          x={619}
          y={74}
          textAnchor="middle"
          className="lc-elabel"
          fill="var(--grn)"
        >
          success
        </text>
        <path
          d="M460 116 L460 212"
          fill="none"
          stroke="var(--amber)"
          strokeWidth={2}
          strokeDasharray="2 7"
          strokeLinecap="round"
          markerEnd="url(#lcwarn)"
        />
        <text
          x={470}
          y={168}
          textAnchor="start"
          className="lc-elabel"
          fill="var(--amber)"
        >
          error
        </text>
        <path
          d="M566 244 L672 244"
          fill="none"
          stroke="var(--line3)"
          strokeWidth={2}
          strokeDasharray="2 7"
          strokeLinecap="round"
          markerEnd="url(#lcar)"
        />
        <text x={619} y={234} textAnchor="middle" className="lc-elabel">
          exhausted
        </text>
        <path
          d="M356 232 C 200 210 150 170 150 120"
          fill="none"
          stroke="var(--indigo)"
          strokeWidth={2}
          strokeDasharray="2 7"
          strokeLinecap="round"
          markerEnd="url(#lcind)"
        />
        <text
          x={206}
          y={196}
          textAnchor="middle"
          className="lc-elabel"
          fill="var(--indigo-br)"
        >
          retry · backoff
        </text>
        <path
          d="M150 116 L150 212"
          fill="none"
          stroke="var(--line3)"
          strokeWidth={2}
          strokeDasharray="2 7"
          strokeLinecap="round"
          markerEnd="url(#lcar)"
        />
        <text x={140} y={168} textAnchor="end" className="lc-elabel">
          cancel
        </text>

        <LcNode x={50} y={52} label="Pending" code="0" cls="s-pending" />
        <LcNode x={360} y={52} label="Running" code="1" cls="s-running" />
        <LcNode x={672} y={52} label="Complete" code="2" cls="s-complete" />
        <LcNode x={360} y={212} label="Failed" code="3" cls="s-failed" />
        <LcNode x={672} y={212} label="Dead" code="4" cls="s-dead" />
        <LcNode x={50} y={212} label="Cancelled" code="5" cls="s-cancel" />
      </svg>
    </div>
  );
}
