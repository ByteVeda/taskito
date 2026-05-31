import { cn } from "@/lib/cn";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
}

/** 40×23 pill toggle: off = surface-3, on = accent; a 17px knob slides 17px. */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  ...aria
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-[23px] w-10 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-accent bg-accent" : "border-[var(--border-strong)] bg-[var(--surface-3)]",
        className,
      )}
      {...aria}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 left-0.5 size-[17px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform",
          checked && "translate-x-[17px]",
        )}
      />
    </button>
  );
}
