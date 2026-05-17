import { ListTree } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Sheet,
  SheetContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import type { TaskEntry } from "../types";
import { TaskOverrideForm } from "./task-override-form";

interface Props {
  tasks: TaskEntry[];
}

export function TaskListTable({ tasks }: Props) {
  const [editing, setEditing] = useState<TaskEntry | null>(null);

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListTree}
        title="No registered tasks"
        description="Decorated tasks will appear here once a Queue is constructed in this process."
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Queue</TableHead>
              <TableHead>Rate limit</TableHead>
              <TableHead>Concurrency</TableHead>
              <TableHead>Retries</TableHead>
              <TableHead>Timeout</TableHead>
              <TableHead>Override</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.name}>
                <TableCell className="font-mono text-xs">{task.name}</TableCell>
                <TableCell>
                  <Badge tone="neutral">{task.queue}</Badge>
                </TableCell>
                <TableCell>
                  <EffectiveCell
                    effective={task.effective.rate_limit}
                    decoratorDefault={task.defaults.rate_limit}
                    formatter={(v) => (v == null ? "—" : String(v))}
                  />
                </TableCell>
                <TableCell>
                  <EffectiveCell
                    effective={task.effective.max_concurrent}
                    decoratorDefault={task.defaults.max_concurrent}
                    formatter={(v) => (v == null ? "—" : String(v))}
                  />
                </TableCell>
                <TableCell>
                  <EffectiveCell
                    effective={task.effective.max_retries}
                    decoratorDefault={task.defaults.max_retries}
                    formatter={(v) => String(v)}
                  />
                </TableCell>
                <TableCell>
                  <EffectiveCell
                    effective={task.effective.timeout}
                    decoratorDefault={task.defaults.timeout}
                    formatter={(v) => `${v}s`}
                  />
                </TableCell>
                <TableCell>
                  {task.paused ? (
                    <Badge tone="warning">Paused</Badge>
                  ) : task.override ? (
                    <Badge tone="info">Override</Badge>
                  ) : (
                    <span className="text-[11px] text-[var(--fg-subtle)]">Default</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(task)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {editing ? <TaskOverrideForm task={editing} onDone={() => setEditing(null)} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

interface CellProps<T> {
  effective: T;
  decoratorDefault: T;
  formatter: (v: T) => string;
}

function EffectiveCell<T>({ effective, decoratorDefault, formatter }: CellProps<T>) {
  const overridden = effective !== decoratorDefault;
  return (
    <span
      className={`font-mono text-xs ${overridden ? "text-accent" : "text-[var(--fg-muted)]"}`}
      title={overridden ? `default: ${formatter(decoratorDefault)}` : undefined}
    >
      {formatter(effective)}
    </span>
  );
}
