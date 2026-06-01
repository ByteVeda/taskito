import { Link } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import {
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import type { DeadLetter } from "@/lib/api-types";
import { formatRelative } from "@/lib/time";
import { useRetryDeadLetter } from "../hooks";

interface DeadLetterTableProps {
  items: DeadLetter[];
}

/** Flat-view table: one row per dead letter, replayable via the retry mutation. */
export function DeadLetterTable({ items }: DeadLetterTableProps) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Original job</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Queue</TableHead>
            <TableHead>Last error</TableHead>
            <TableHead className="text-right">Failed</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <DeadLetterTableRow key={item.id} item={item} />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function DeadLetterTableRow({ item }: { item: DeadLetter }) {
  const retry = useRetryDeadLetter();
  return (
    <TableRow>
      <TableCell>
        <Link
          to="/jobs/$id"
          params={{ id: item.original_job_id }}
          className="font-mono text-[0.82rem] tabular-nums text-accent hover:underline"
        >
          {item.original_job_id.slice(0, 8)}…
        </Link>
      </TableCell>
      <TableCell className="font-medium text-[var(--fg)]">{item.task_name}</TableCell>
      <TableCell className="text-[var(--fg-muted)]">{item.queue}</TableCell>
      <TableCell className="max-w-[300px]">
        {item.error ? (
          <span className="block truncate font-mono text-[0.78rem] text-danger" title={item.error}>
            {item.error}
          </span>
        ) : (
          <span className="text-[var(--fg-subtle)]">—</span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono text-[0.82rem] tabular-nums text-[var(--fg-muted)]">
        {formatRelative(item.failed_at)}
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => retry.mutate(item.id)}
          disabled={retry.isPending}
        >
          <RotateCcw aria-hidden /> Replay
        </Button>
      </TableCell>
    </TableRow>
  );
}
