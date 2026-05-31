import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Render the value (e.g. append a unit). Defaults to the raw number. */
  format?: (value: number) => string;
  "aria-label"?: string;
  className?: string;
}

/** A −/+ number stepper with a mono value readout. */
export function Stepper({
  value,
  onChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  format,
  className,
  "aria-label": ariaLabel,
}: StepperProps) {
  const round = (n: number) => Number(n.toFixed(4));
  const dec = () => onChange(Math.max(min, round(value - step)));
  const inc = () => onChange(Math.min(max, round(value + step)));
  return (
    <div
      className={cn(
        "inline-flex items-center overflow-hidden rounded-[var(--btn-radius)] border border-[var(--border-strong)]",
        className,
      )}
    >
      <button
        type="button"
        onClick={dec}
        disabled={value <= min}
        aria-label={ariaLabel ? `Decrease ${ariaLabel}` : "Decrease"}
        className="grid size-[34px] place-items-center text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Minus className="size-3.5" aria-hidden />
      </button>
      <span className="min-w-[48px] px-1 text-center font-mono text-[0.85rem] tabular-nums">
        {format ? format(value) : value}
      </span>
      <button
        type="button"
        onClick={inc}
        disabled={value >= max}
        aria-label={ariaLabel ? `Increase ${ariaLabel}` : "Increase"}
        className="grid size-[34px] place-items-center text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
