import type { ComponentChildren } from "preact";

interface ButtonProps {
  onClick?: () => void;
  variant?: "primary" | "danger" | "ghost";
  disabled?: boolean;
  children: ComponentChildren;
  class?: string;
}

const VARIANTS: Record<string, string> = {
  primary:
    "bg-accent text-white shadow-sm shadow-accent/20 hover:bg-accent/90 hover:shadow-md hover:shadow-accent/25 active:scale-[0.98]",
  danger:
    "bg-danger text-white shadow-sm shadow-danger/20 hover:bg-danger/90 hover:shadow-md hover:shadow-danger/25 active:scale-[0.98]",
  ghost:
    "dark:text-gray-400 text-slate-500 hover:dark:bg-surface-3 hover:bg-slate-100 hover:dark:text-gray-200 hover:text-slate-700 active:scale-[0.98]",
};

export function Button({
  onClick,
  variant = "primary",
  disabled,
  children,
  class: className = "",
}: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      class={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium cursor-pointer transition-all duration-150 disabled:opacity-40 disabled:cursor-default disabled:shadow-none border-none ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
