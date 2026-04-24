import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui";

const ALL = "__all__";

interface TaskSelectorProps {
  value: string | undefined;
  tasks: string[];
  onChange: (v: string | undefined) => void;
  className?: string;
}

export function TaskSelector({ value, tasks, onChange, className }: TaskSelectorProps) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={className} aria-label="Task filter">
        <SelectValue placeholder="All tasks" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All tasks</SelectItem>
        {tasks.map((task) => (
          <SelectItem key={task} value={task}>
            {task}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
