// Process-wide accumulator for proxy reconstruction metrics, surfaced by the
// dashboard's /api/proxy-stats endpoint (snake_case contract shape).

interface HandlerMetrics {
  reconstructions: number;
  errors: number;
  cleanupErrors: number;
  checksumFailures: number;
  totalDurationMs: number;
  maxDurationMs: number;
  durations: number[];
}

/** One handler's stats in the dashboard wire shape. */
export interface ProxyHandlerStats {
  handler: string;
  total_reconstructions: number;
  total_errors: number;
  total_cleanup_errors: number;
  total_checksum_failures: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  p95_duration_ms: number;
}

/** Cap the retained duration samples so long-lived processes stay bounded. */
const MAX_SAMPLES = 1000;

export class ProxyMetrics {
  private readonly handlers = new Map<string, HandlerMetrics>();

  private handler(name: string): HandlerMetrics {
    let entry = this.handlers.get(name);
    if (!entry) {
      entry = {
        reconstructions: 0,
        errors: 0,
        cleanupErrors: 0,
        checksumFailures: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        durations: [],
      };
      this.handlers.set(name, entry);
    }
    return entry;
  }

  recordReconstruction(handlerName: string, durationMs: number): void {
    const entry = this.handler(handlerName);
    entry.reconstructions += 1;
    entry.totalDurationMs += durationMs;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, durationMs);
    entry.durations.push(durationMs);
    if (entry.durations.length > MAX_SAMPLES) {
      entry.durations.shift();
    }
  }

  recordError(handlerName: string): void {
    this.handler(handlerName).errors += 1;
  }

  recordCleanupError(handlerName: string): void {
    this.handler(handlerName).cleanupErrors += 1;
  }

  recordChecksumFailure(handlerName: string): void {
    this.handler(handlerName).checksumFailures += 1;
  }

  toList(): ProxyHandlerStats[] {
    return [...this.handlers.entries()].map(([name, h]) => {
      const sorted = [...h.durations].sort((a, b) => a - b);
      const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;
      return {
        handler: name,
        total_reconstructions: h.reconstructions,
        total_errors: h.errors,
        total_cleanup_errors: h.cleanupErrors,
        total_checksum_failures: h.checksumFailures,
        total_duration_ms: round2(h.totalDurationMs),
        avg_duration_ms: round2(h.reconstructions > 0 ? h.totalDurationMs / h.reconstructions : 0),
        max_duration_ms: round2(h.maxDurationMs),
        p95_duration_ms: round2(p95 ?? sorted[sorted.length - 1] ?? 0),
      };
    });
  }

  reset(): void {
    this.handlers.clear();
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Shared per-process accumulator every `Proxies` registry records into. */
export const proxyMetrics = new ProxyMetrics();
