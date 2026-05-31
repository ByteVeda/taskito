import { ListTree } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
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
import { formatDuration } from "@/lib/time";
import type { TaskEntry } from "../types";
import { TaskOverrideForm } from "./task-override-form";

interface Props {
  tasks: TaskEntry[];
}

const numCell = "text-right font-mono text-[0.82rem] tabular-nums";

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
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Queue</TableHead>
              <TableHead className="text-right">Priority</TableHead>
              <TableHead className="text-right">Max retries</TableHead>
              <TableHead className="text-right">Timeout</TableHead>
              <TableHead>Rate limit</TableHead>
              <TableHead className="text-right">Config</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const rateLimit = task.effective.rate_limit;
              return (
                <TableRow key={task.name}>
                  <TableCell className="font-mono text-[0.82rem] font-medium text-[var(--fg)]">
                    {task.name}
                  </TableCell>
                  <TableCell className="text-[var(--fg-muted)]">{task.queue}</TableCell>
                  <TableCell className={numCell}>{task.effective.priority}</TableCell>
                  <TableCell className={`${numCell} text-[var(--fg-muted)]`}>
                    {task.effective.max_retries}
                  </TableCell>
                  <TableCell className={`${numCell} text-[var(--fg-muted)]`}>
                    {formatDuration(task.effective.timeout * 1000)}
                  </TableCell>
                  <TableCell>
                    {rateLimit ? (
                      <Badge tone="warning">{rateLimit}</Badge>
                    ) : (
                      <span className="text-[var(--fg-subtle)]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {task.paused ? (
                      <Badge tone="warning" dot>
                        Paused
                      </Badge>
                    ) : task.override ? (
                      <Badge tone="info" dot>
                        Override
                      </Badge>
                    ) : (
                      <span className="text-[0.78rem] text-[var(--fg-subtle)]">default</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(task)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {editing ? <TaskOverrideForm task={editing} onDone={() => setEditing(null)} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
