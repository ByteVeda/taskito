export type TimeRange = "15m" | "1h" | "6h" | "24h";

export const DEFAULT_TIME_RANGE: TimeRange = "1h";

export interface TimeRangeConfig {
  value: TimeRange;
  sinceSeconds: number;
  bucketSeconds: number;
}

/**
 * Bucket sizes chosen so every range produces ~60 points on the chart — the
 * sweet spot for resolution vs. readability.
 */
export const TIME_RANGES: TimeRangeConfig[] = [
  { value: "15m", sinceSeconds: 15 * 60, bucketSeconds: 15 },
  { value: "1h", sinceSeconds: 60 * 60, bucketSeconds: 60 },
  { value: "6h", sinceSeconds: 6 * 60 * 60, bucketSeconds: 6 * 60 },
  { value: "24h", sinceSeconds: 24 * 60 * 60, bucketSeconds: 24 * 60 },
];

export function timeRangeConfig(value: TimeRange): TimeRangeConfig {
  return TIME_RANGES.find((r) => r.value === value) ?? TIME_RANGES[1]!;
}
