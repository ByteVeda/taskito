import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("animate-shimmer rounded-md bg-[var(--surface-2)]", className)} {...props} />
  );
}
