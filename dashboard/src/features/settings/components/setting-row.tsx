import type { ReactNode } from "react";

/**
 * Two-column row with a label/description on the left and a form control
 * on the right. Used across all settings sections so spacing stays
 * consistent.
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-4 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <div className="flex flex-col gap-1">
        <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--fg)]">
          {label}
        </label>
        {description ? (
          <p className="text-[12px] text-[var(--fg-subtle)] leading-snug">{description}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
