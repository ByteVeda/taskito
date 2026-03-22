export function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "\u2014";
  const d = new Date(ms);
  return (
    d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) +
    " " +
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  );
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString();
}

export function truncateId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) : id;
}
