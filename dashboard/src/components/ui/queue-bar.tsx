import { cn } from "@/lib/cn";

interface QueueBarProps {
  pending: number;
  running: number;
  /** failed + dead combined. */
  failedTotal: number;
  className?: string;
}

interface Segment {
  value: number;
  color: string;
  label: string;
}

/**
 * The live workload *mix* as proportional segments: running (info) ·
 * pending (subtle) · failed/dead (danger). Lifetime "completed" is
 * deliberately excluded — it swamps everything. When all three are zero we
 * render a faint full success sliver ("all clear").
 */
export function QueueBar({ pending, running, failedTotal, className }: QueueBarProps) {
  const total = pending + running + failedTotal;
  const segments: Segment[] = [
    { value: running, color: "var(--info)", label: "running" },
    { value: pending, color: "var(--fg-subtle)", label: "pending" },
    { value: failedTotal, color: "var(--danger)", label: "failed/dead" },
  ];
  return (
    <div
      className={cn(
        "flex h-1.5 min-w-[90px] overflow-hidden rounded-full bg-[var(--surface-3)]",
        className,
      )}
      title="running · pending · failed"
    >
      {total === 0 ? (
        <span
          className="h-full w-full"
          style={{ background: "var(--success-dim)" }}
          title="all clear"
        />
      ) : (
        segments.map((seg) =>
          seg.value > 0 ? (
            <span
              key={seg.label}
              className="h-full"
              style={{ width: `${(seg.value / total) * 100}%`, background: seg.color }}
              title={`${seg.label}: ${seg.value}`}
            />
          ) : null,
        )
      )}
    </div>
  );
}
