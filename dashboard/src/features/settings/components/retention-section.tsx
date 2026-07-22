import { Trash2 } from "lucide-react";
import {
  Badge,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { formatRelative } from "@/lib/time";
import { formatRetentionWindow, RETENTION_TABLES } from "../derived";
import { useRetention } from "../hooks";
import type { RetentionSnapshot } from "../types";

/** On / off / unreported — the three states an operator has to tell apart. */
function RetentionStatus({ snapshot }: { snapshot: RetentionSnapshot }) {
  if (!snapshot.reported) return <Badge tone="neutral">Not reported</Badge>;
  return snapshot.enabled ? (
    <Badge tone="warning" dot>
      Deleting history
    </Badge>
  ) : (
    <Badge tone="neutral" dot>
      Disabled
    </Badge>
  );
}

function WindowTable({ snapshot }: { snapshot: RetentionSnapshot }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Table</TableHead>
          <TableHead>Deleted after</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {RETENTION_TABLES.map(({ key, label, description }) => (
          <TableRow key={key}>
            <TableCell>
              <div className="font-medium text-[var(--fg)]">{label}</div>
              <div className="mt-0.5 text-xs text-[var(--fg-muted)]">{description}</div>
            </TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">
              {formatRetentionWindow(snapshot.windows[key])}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Why rows vanish from the job, log, and dead-letter listings. Retention runs
 * in the worker process, so these are the windows the elected cleaner reported
 * — not this dashboard's configuration. Read-only: the windows are set where
 * the worker is started.
 */
export function RetentionSection() {
  const { data, isLoading } = useRetention();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Retention</CardTitle>
            <CardDescription>
              How long each history table keeps a row before auto-cleanup deletes it. Set where the
              worker is started; reported here by the worker that enforces it.
            </CardDescription>
          </div>
          {data ? <RetentionStatus snapshot={data} /> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-[var(--gap)]">
        {isLoading || !data ? (
          <Skeleton className="h-64 rounded-[var(--card-radius)]" />
        ) : !data.reported ? (
          <EmptyState
            icon={Trash2}
            title="No worker has reported its retention windows"
            description="The worker elected to run cleanup publishes them on its first sweep. Until then the active policy is unknown — not necessarily off."
          />
        ) : (
          <>
            {data.defaulted ? (
              <Callout tone="warning">
                Running on the recommended defaults — no windows were configured. History is being
                deleted on the schedule below.
              </Callout>
            ) : null}
            {!data.enabled ? (
              <Callout tone="info">
                Retention is disabled: no table has a window, so history is kept until you delete
                it. Jobs and dead letters carry their own per-entry TTLs, which still apply.
              </Callout>
            ) : (
              <WindowTable snapshot={data} />
            )}
            <div className="text-xs text-[var(--fg-muted)]">
              Namespace <span className="font-medium text-[var(--fg)]">{data.namespace}</span> ·
              reported {formatRelative(data.reported_at)}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
