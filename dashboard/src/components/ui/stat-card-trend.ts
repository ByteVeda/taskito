export type TrendDirection = "up" | "down" | "flat";

export interface StatTrend {
  direction: TrendDirection;
  /** Display label (e.g. "12%", "+4 / hr"). Caller controls formatting. */
  label: string;
  /**
   * Whether `up` should read as positive. Defaults to true. Set false for
   * metrics where rising is bad (e.g. failures, latency) so colors invert.
   */
  upIsGood?: boolean;
}

export function trendToneClass(direction: TrendDirection, upIsGood: boolean): string {
  if (direction === "flat") return "text-[var(--fg-subtle)]";
  const positive = direction === "up" ? upIsGood : !upIsGood;
  return positive ? "text-success" : "text-danger";
}

/**
 * Compare current vs previous bucket totals and produce a trend descriptor.
 * Returns `null` when there is no previous data to compare against — the
 * caller should treat that as "no trend yet" rather than rendering "flat".
 */
export function computeTrend(
  current: number,
  previous: number,
  options: { upIsGood?: boolean } = {},
): StatTrend | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0 && current === 0)
    return { direction: "flat", label: "0%", upIsGood: options.upIsGood };
  if (previous === 0) {
    return { direction: "up", label: "new", upIsGood: options.upIsGood };
  }
  const delta = current - previous;
  const pct = Math.round((delta / previous) * 100);
  if (pct === 0) return { direction: "flat", label: "0%", upIsGood: options.upIsGood };
  return {
    direction: pct > 0 ? "up" : "down",
    label: `${pct > 0 ? "+" : ""}${pct}%`,
    upIsGood: options.upIsGood,
  };
}
