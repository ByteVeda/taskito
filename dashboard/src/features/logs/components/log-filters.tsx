import { useEffect, useState } from "react";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { useDebouncedValue } from "@/hooks";
import { cn } from "@/lib/cn";
import { LOG_LEVELS, type LogLevel } from "../api";

const ALL_LEVELS = "__all__";

interface LogFiltersProps {
  task: string | undefined;
  level: LogLevel | undefined;
  onChange: (next: { task?: string; level?: LogLevel }) => void;
  className?: string;
}

export function LogFilters({ task, level, onChange, className }: LogFiltersProps) {
  const [localTask, setLocalTask] = useState(task ?? "");
  const debounced = useDebouncedValue(localTask, 300);

  useEffect(() => {
    setLocalTask(task ?? "");
  }, [task]);

  useEffect(() => {
    const next = debounced.trim() || undefined;
    if (next !== task) {
      onChange({ task: next, level });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- propagate only debounced value
  }, [debounced, task, onChange, level]);

  return (
    <div className={cn("grid gap-2 md:grid-cols-[1fr_200px]", className)}>
      <Input
        value={localTask}
        onChange={(e) => setLocalTask(e.target.value)}
        placeholder="Filter by task name…"
      />
      <Select
        value={level ?? ALL_LEVELS}
        onValueChange={(v) =>
          onChange({ task, level: v === ALL_LEVELS ? undefined : (v as LogLevel) })
        }
      >
        <SelectTrigger aria-label="Log level">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_LEVELS}>All levels</SelectItem>
          {LOG_LEVELS.map((lvl) => (
            <SelectItem key={lvl} value={lvl}>
              {lvl}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
