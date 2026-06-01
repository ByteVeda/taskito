import { CircuitBoard } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  MeterBar,
  Skeleton,
} from "@/components/ui";
import type { CircuitBreaker } from "@/lib/api-types";
import { CIRCUIT_LABEL, CIRCUIT_TONE } from "@/lib/status";
import { formatDuration, formatRelative } from "@/lib/time";

interface CircuitBreakersTableProps {
  breakers: CircuitBreaker[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function CircuitBreakersTable({
  breakers,
  loading,
  error,
  onRetry,
}: CircuitBreakersTableProps) {
  if (error) {
    return (
      <ErrorState
        title="Couldn't load circuit breakers"
        description={error.message}
        onRetry={onRetry}
      />
    );
  }

  if (loading && !breakers) {
    return (
      <div className="grid gap-[var(--gap)] [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
        {Array.from({ length: 4 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholders
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    );
  }

  if (!breakers || breakers.length === 0) {
    return (
      <EmptyState
        icon={CircuitBoard}
        title="No circuit breakers configured"
        description="Circuit breakers open when a task fails more than the threshold within a window."
      />
    );
  }

  return (
    <div className="grid gap-[var(--gap)] [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
      {breakers.map((breaker) => (
        <CircuitBreakerCard key={breaker.task_name} breaker={breaker} />
      ))}
    </div>
  );
}

function CircuitBreakerCard({ breaker }: { breaker: CircuitBreaker }) {
  const { task_name, state, failure_count, threshold, window_ms, cooldown_ms, last_failure_at } =
    breaker;
  const tone = CIRCUIT_TONE[state];
  const pct = threshold > 0 ? (failure_count / threshold) * 100 : 0;

  return (
    <Card className="transition-shadow hover:shadow-[var(--card-hover-shadow)]">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[0.84rem] font-semibold text-[var(--fg)]">
            {task_name}
          </span>
          <Badge tone={tone} dot>
            {CIRCUIT_LABEL[state]}
          </Badge>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--fg-muted)]">
            <span>Failures in window</span>
            <span className="font-mono tabular-nums">
              {failure_count} / {threshold}
            </span>
          </div>
          <MeterBar value={pct} tone={tone} />
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-3">
          <CircuitMeta label="Window" value={formatDuration(window_ms)} />
          <CircuitMeta label="Cooldown" value={formatDuration(cooldown_ms)} />
          <CircuitMeta
            label="Last failure"
            value={last_failure_at ? formatRelative(last_failure_at) : "never"}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CircuitMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.68rem] uppercase tracking-wide text-[var(--fg-subtle)]">
        {label}
      </span>
      <span className="font-mono text-[0.78rem] tabular-nums text-[var(--fg)]">{value}</span>
    </div>
  );
}
