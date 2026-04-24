const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatAbsolute(iso: string | number | Date): string {
  const date = typeof iso === "string" || typeof iso === "number" ? new Date(iso) : iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

export function formatRelative(iso: string | number | Date, nowMs?: number): string {
  const target = typeof iso === "string" || typeof iso === "number" ? new Date(iso) : iso;
  const now = nowMs ?? Date.now();
  const diffSec = Math.round((target.getTime() - now) / 1000);
  for (const [unit, step] of UNITS) {
    if (Math.abs(diffSec) >= step || unit === "second") {
      return RTF.format(Math.round(diffSec / step), unit);
    }
  }
  return RTF.format(diffSec, "second");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m - h * 60;
  return `${h}h ${rm}m`;
}
