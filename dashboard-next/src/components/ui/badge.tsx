import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tracking-tight",
  {
    variants: {
      tone: {
        neutral:
          "bg-[var(--surface-3)] text-[var(--fg-muted)] ring-1 ring-inset ring-[var(--border-strong)]",
        accent: "bg-accent-dim text-accent ring-1 ring-inset ring-accent/30",
        info: "bg-info-dim text-info ring-1 ring-inset ring-info/30",
        success: "bg-success-dim text-success ring-1 ring-inset ring-success/30",
        warning: "bg-warning-dim text-warning ring-1 ring-inset ring-warning/30",
        danger: "bg-danger-dim text-danger ring-1 ring-inset ring-danger/30",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}

export { badgeVariants };
