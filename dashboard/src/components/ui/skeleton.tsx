import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("animate-shimmer rounded-md bg-[var(--surface-2)]", className)} {...props} />
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: Array<string | number>;
  className?: string;
}

/**
 * Table-shaped skeleton — gives a placeholder that matches the eventual row
 * grid instead of a single opaque block. Pass widths per column (Tailwind
 * class like "w-32" or numeric ch units).
 */
export function TableSkeleton({
  rows = 8,
  columns = ["w-24", "w-40", "w-20", "w-16", "w-28", "w-24"],
  className,
}: TableSkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-lg bg-[var(--surface)] ring-1 ring-inset ring-[var(--border)] shadow-xs",
        className,
      )}
    >
      <div className="flex items-center gap-6 border-b border-[var(--border)] px-4 py-3">
        {columns.map((width, idx) => (
          <Skeleton
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton order is stable
            key={`head-${idx}`}
            className={cn("h-3", typeof width === "number" ? undefined : width)}
            style={typeof width === "number" ? { width: `${width}ch` } : undefined}
          />
        ))}
      </div>
      <div className="divide-y divide-[var(--border)]">
        {Array.from({ length: rows }, (_, rowIdx) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton order is stable
            key={`row-${rowIdx}`}
            className="flex items-center gap-6 px-4 py-3"
          >
            {columns.map((width, colIdx) => (
              <Skeleton
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton order is stable
                key={`cell-${rowIdx}-${colIdx}`}
                className={cn("h-4", typeof width === "number" ? undefined : width)}
                style={typeof width === "number" ? { width: `${width}ch` } : undefined}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
