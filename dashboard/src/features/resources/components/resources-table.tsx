import { Activity } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  MeterBar,
  Skeleton,
} from "@/components/ui";
import type { ResourceStatus } from "@/lib/api-types";
import { resourceTone } from "@/lib/status";
import { formatDuration } from "@/lib/time";

interface ResourcesTableProps {
  resources: ResourceStatus[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function ResourcesTable({ resources, loading, error, onRetry }: ResourcesTableProps) {
  if (error) {
    return (
      <ErrorState title="Couldn't load resources" description={error.message} onRetry={onRetry} />
    );
  }

  if (loading && !resources) {
    return (
      <div className="grid gap-[var(--gap)] [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
        {Array.from({ length: 4 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholders
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    );
  }

  if (!resources || resources.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No resources registered"
        description="Register shared infrastructure via @queue.worker_resource()."
      />
    );
  }

  return (
    <div className="grid gap-[var(--gap)] [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
      {resources.map((resource) => (
        <ResourceCard key={resource.name} resource={resource} />
      ))}
    </div>
  );
}

function ResourceCard({ resource }: { resource: ResourceStatus }) {
  const { name, scope, health, depends_on, pool, init_duration_ms, recreations } = resource;
  const util = pool && pool.size > 0 ? (pool.active / pool.size) * 100 : 0;

  return (
    <Card className="transition-shadow hover:shadow-[var(--card-hover-shadow)]">
      <CardContent className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between gap-2.5">
          <span className="truncate font-mono text-[0.86rem] font-semibold text-[var(--fg)]">
            {name}
          </span>
          <Badge tone={resourceTone(health)} dot>
            {health}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge tone="neutral">{scope}</Badge>
          {depends_on.map((dep) => (
            <Badge key={dep} tone="accent">
              ↳ {dep}
            </Badge>
          ))}
        </div>

        {pool ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-xs text-[var(--fg-muted)]">
              <span>Pool usage</span>
              <span className="font-mono tabular-nums" title={`${pool.idle} idle`}>
                {pool.active} / {pool.size} busy
              </span>
            </div>
            <MeterBar value={util} tone={util > 85 ? "danger" : "info"} />
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-3">
          <ResourceMeta label="Init" value={formatDuration(init_duration_ms)} />
          <ResourceMeta
            label="Recreations"
            value={String(recreations)}
            className={recreations > 0 ? "text-warning" : undefined}
          />
          <ResourceMeta
            label="Timeouts"
            value={pool ? String(pool.total_timeouts) : "—"}
            className={pool && pool.total_timeouts > 0 ? "text-danger" : undefined}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ResourceMeta({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.68rem] uppercase tracking-wide text-[var(--fg-subtle)]">
        {label}
      </span>
      <span className={`font-mono text-[0.78rem] tabular-nums ${className ?? "text-[var(--fg)]"}`}>
        {value}
      </span>
    </div>
  );
}
