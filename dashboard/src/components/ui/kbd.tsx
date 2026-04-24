import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded px-1 font-mono text-[10px] font-medium",
        "bg-[var(--surface-3)] text-[var(--fg-muted)] ring-1 ring-inset ring-[var(--border-strong)]",
        className,
      )}
      {...props}
    />
  );
}
