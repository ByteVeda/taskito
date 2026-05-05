import { cn } from "@/lib/cn";

interface MiniSparklineProps {
  values: number[];
  /** Tone of the line + fill. */
  tone?: "accent" | "info" | "success" | "warning" | "danger";
  className?: string;
}

const TONE_VAR: Record<NonNullable<MiniSparklineProps["tone"]>, string> = {
  accent: "var(--color-accent)",
  info: "var(--color-info)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
};

/**
 * Tiny inline sparkline for use inside a `StatCard`. Renders flat at a single
 * point or with empty data — caller decides whether to render at all.
 */
export function MiniSparkline({ values, tone = "accent", className }: MiniSparklineProps) {
  const width = 80;
  const height = 18;
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const stroke = TONE_VAR[tone];
  const gradId = `mini-spark-${tone}`;

  const linePath = values
    .map((v, i) => {
      const x = i * step;
      const y = height - (v / max) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="trend sparkline"
      preserveAspectRatio="none"
      className={cn("h-4 w-20", className)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
