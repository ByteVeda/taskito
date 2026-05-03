const STATIONS = [
  { label: "enqueue", cx: 30 },
  { label: "queue", cx: 110 },
  { label: "worker", cx: 190 },
  { label: "result", cx: 270 },
] as const;

const VIEW_WIDTH = 300;
const TRACK_Y = 22;
const STATION_RADIUS = 6;

export function HowItWorks() {
  return (
    <section className="px-4 pb-16 max-w-3xl mx-auto w-full">
      <div className="text-center mb-6">
        <h2 className="text-xs uppercase tracking-[0.18em] text-fd-muted-foreground font-medium">
          How it works
        </h2>
      </div>
      <div className="flex justify-center">
        <svg
          role="img"
          aria-label="Job lifecycle: a job travels from your code to the queue, to a worker, then back as a result"
          viewBox={`0 0 ${VIEW_WIDTH} 56`}
          className="w-full max-w-lg"
        >
          <line
            x1={STATIONS[0].cx}
            y1={TRACK_Y}
            x2={STATIONS[STATIONS.length - 1].cx}
            y2={TRACK_Y}
            stroke="var(--color-fd-border)"
            strokeWidth="1.5"
            strokeDasharray="3 4"
          />
          {STATIONS.map((station) => (
            <g key={station.label}>
              <circle
                cx={station.cx}
                cy={TRACK_Y}
                r={STATION_RADIUS}
                fill="var(--color-fd-card)"
                stroke="var(--color-fd-border)"
                strokeWidth="1.5"
              />
              <text
                x={station.cx}
                y={TRACK_Y + 24}
                textAnchor="middle"
                fill="var(--color-fd-muted-foreground)"
                fontSize="10"
                fontWeight="500"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {station.label}
              </text>
            </g>
          ))}
          <circle
            className="taskito-job-pulse"
            cx={STATIONS[0].cx}
            cy={TRACK_Y}
            r={STATION_RADIUS + 2}
            fill="none"
            stroke="var(--color-fd-primary)"
            strokeWidth="1.25"
            opacity="0"
          />
          <circle
            className="taskito-job-dot"
            cx={STATIONS[0].cx}
            cy={TRACK_Y}
            r="3.5"
            fill="var(--color-fd-primary)"
          />
        </svg>
      </div>
      <style>{`
        @keyframes taskito-job-travel {
          0%   { cx: 30px; opacity: 0; }
          5%   { cx: 30px; opacity: 1; }
          22%  { cx: 110px; opacity: 1; }
          32%  { cx: 110px; opacity: 1; }
          47%  { cx: 190px; opacity: 1; }
          57%  { cx: 190px; opacity: 1; }
          74%  { cx: 270px; opacity: 1; }
          88%  { cx: 270px; opacity: 1; }
          94%  { cx: 270px; opacity: 0; }
          100% { cx: 30px; opacity: 0; }
        }
        @keyframes taskito-station-pulse {
          0%, 18%   { cx: 30px;  r: 8px;  opacity: 0; }
          22%       { cx: 30px;  r: 12px; opacity: 0.6; }
          26%       { cx: 30px;  r: 14px; opacity: 0; }
          27%, 28%  { cx: 110px; r: 8px;  opacity: 0; }
          32%       { cx: 110px; r: 12px; opacity: 0.6; }
          36%       { cx: 110px; r: 14px; opacity: 0; }
          37%, 53%  { cx: 190px; r: 8px;  opacity: 0; }
          57%       { cx: 190px; r: 12px; opacity: 0.6; }
          61%       { cx: 190px; r: 14px; opacity: 0; }
          62%, 70%  { cx: 270px; r: 8px;  opacity: 0; }
          74%       { cx: 270px; r: 12px; opacity: 0.6; }
          78%       { cx: 270px; r: 14px; opacity: 0; }
          100%      { cx: 270px; r: 8px;  opacity: 0; }
        }
        @media (prefers-reduced-motion: no-preference) {
          .taskito-job-dot {
            animation: taskito-job-travel 4.5s ease-in-out infinite;
          }
          .taskito-job-pulse {
            animation: taskito-station-pulse 4.5s ease-in-out infinite;
          }
        }
      `}</style>
    </section>
  );
}
