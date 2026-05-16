import { X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Badge, Input } from "@/components/ui";

interface Props {
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}

/**
 * Free-form task name list input. ``null`` means "deliver for every task";
 * an empty array means "deliver for no task" (effectively disabled).
 *
 * Tasks are added by typing a name and pressing Enter, comma, or space.
 */
export function TaskFilterInput({ value, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const enabled = value !== null;
  const tasks = value ?? [];

  function commitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!tasks.includes(trimmed)) onChange([...tasks, trimmed]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === " ") {
      event.preventDefault();
      commitDraft();
    } else if (event.key === "Backspace" && !draft && tasks.length > 0) {
      onChange(tasks.slice(0, -1));
    }
  }

  function remove(task: string) {
    onChange(tasks.filter((t) => t !== task));
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? [] : null)}
        />
        Restrict to specific task names
      </label>
      {enabled ? (
        <>
          <Input
            value={draft}
            placeholder="e.g. send_email"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commitDraft}
          />
          {tasks.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tasks.map((task) => (
                <Badge key={task} tone="neutral" className="font-mono text-[11px]">
                  {task}
                  <button
                    type="button"
                    onClick={() => remove(task)}
                    aria-label={`Remove ${task}`}
                    className="ml-1 text-[var(--fg-subtle)] hover:text-[var(--fg)]"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </Badge>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
