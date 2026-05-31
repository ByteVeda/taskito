import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface KvItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

interface KvListProps {
  items: KvItem[];
  /** Lay rows out in two columns on wider screens (default) or a single one. */
  columns?: 1 | 2;
  className?: string;
}

/** A label/value list — runtime info, config snapshots. */
export function KvList({ items, columns = 2, className }: KvListProps) {
  return (
    <dl
      className={cn(
        "grid gap-x-[22px] [&>div:nth-last-of-type(-n+2)]:border-b-0",
        columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1",
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center justify-between gap-2.5 border-b border-[var(--border)]/60 py-2.5"
        >
          <dt className="text-[0.8rem] text-[var(--fg-subtle)]">{item.label}</dt>
          <dd
            className={cn(
              "text-[0.85rem] font-semibold text-[var(--fg)]",
              item.mono && "font-mono tabular-nums",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
