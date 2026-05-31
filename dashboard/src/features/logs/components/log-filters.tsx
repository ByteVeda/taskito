import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input, Segmented, type SegmentedOption } from "@/components/ui";
import { useDebouncedValue } from "@/hooks";
import { cn } from "@/lib/cn";
import { LOG_LEVELS, type LogLevel } from "../api";

const ALL_LEVELS = "__all__";

type LevelValue = LogLevel | typeof ALL_LEVELS;

const LEVEL_OPTIONS: SegmentedOption<LevelValue>[] = [
  { value: ALL_LEVELS, label: "All" },
  ...LOG_LEVELS.map((lvl) => ({
    value: lvl,
    label: lvl.charAt(0).toUpperCase() + lvl.slice(1),
  })),
];

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
    <div className={cn("flex flex-wrap items-center gap-2.5", className)}>
      <Segmented
        aria-label="Log level"
        options={LEVEL_OPTIONS}
        value={level ?? ALL_LEVELS}
        onChange={(v) => onChange({ task, level: v === ALL_LEVELS ? undefined : v })}
      />
      <div className="relative max-w-80 flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-[15px] -translate-y-1/2 text-[var(--fg-subtle)]"
          aria-hidden
        />
        <Input
          value={localTask}
          onChange={(e) => setLocalTask(e.target.value)}
          placeholder="Filter by message or task…"
          className="pl-8"
        />
      </div>
    </div>
  );
}
