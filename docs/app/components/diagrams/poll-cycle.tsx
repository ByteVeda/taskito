// Scheduler poll loop — faithful port of arch.js `pollcycle()` (50ms-tick clock
// with a CSS-animated sweep + cadence legend). `architecture/scheduler.mdx`.

const CX = 180;
const CY = 180;
const R = 120;

const TASKS = [
  {
    a: -90,
    name: "try_dispatch",
    cad: "every tick",
    accent: "var(--indigo-br)",
  },
  {
    a: 0,
    name: "check_periodic",
    cad: "~3s · 60 ticks",
    accent: "var(--cyan)",
  },
  { a: 90, name: "reap_stale", cad: "~5s · 100 ticks", accent: "var(--amber)" },
  {
    a: 180,
    name: "auto_cleanup",
    cad: "~60s · 1200 ticks",
    accent: "var(--mut)",
  },
];

export function SchedulerPollLoop() {
  return (
    <div className="pc-wrap">
      <svg
        viewBox="0 0 360 360"
        className="pc-svg"
        role="img"
        aria-label="Scheduler poll loop: a 50ms tick runs try_dispatch every tick, check_periodic ~every 3s, reap_stale ~every 5s, and auto_cleanup ~every 60s."
      >
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="var(--line2)"
          strokeWidth={2}
          strokeDasharray="3 7"
        />
        <g className="pc-sweep">
          <line
            x1={CX}
            y1={CY}
            x2={CX}
            y2={CY - R}
            stroke="var(--indigo)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <circle cx={CX} cy={CY - R} r={6} fill="var(--indigo)" />
        </g>
        {TASKS.map((t) => {
          const rad = (t.a * Math.PI) / 180;
          return (
            <circle
              key={t.name}
              cx={CX + R * Math.cos(rad)}
              cy={CY + R * Math.sin(rad)}
              r={7}
              fill="var(--panel)"
              stroke={t.accent}
              strokeWidth={2.5}
            />
          );
        })}
        <text x={CX} y={174} textAnchor="middle" className="pc-center">
          50ms
        </text>
        <text x={CX} y={196} textAnchor="middle" className="pc-centersub">
          tick
        </text>
      </svg>
      <div className="pc-legend">
        {TASKS.map((t) => (
          <div className="pc-leg" key={t.name}>
            <span className="pc-dot" style={{ background: t.accent }} />
            <span className="pc-name">{t.name}()</span>
            <span className="pc-cad">{t.cad}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
