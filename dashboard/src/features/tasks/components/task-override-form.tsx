import { Save, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button, Input, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { useClearTaskOverride, useSetTaskOverride } from "../hooks";
import type { TaskEntry, TaskOverridePatch } from "../types";
import { MiddlewareToggles } from "./middleware-toggles";

interface Props {
  task: TaskEntry;
  onDone?: () => void;
}

/**
 * Side-panel form for editing a task's overrides. Empty inputs mean
 * "inherit the decorator default" (the override field is omitted /
 * cleared); a non-empty value overrides the default. Submit applies the
 * change; ``Clear`` removes the override entirely.
 */
export function TaskOverrideForm({ task, onDone }: Props) {
  const setOverride = useSetTaskOverride();
  const clearOverride = useClearTaskOverride();

  const o = task.override ?? {};
  const [rateLimit, setRateLimit] = useState(o.rate_limit ?? "");
  const [maxConcurrent, setMaxConcurrent] = useState(
    o.max_concurrent != null ? String(o.max_concurrent) : "",
  );
  const [maxRetries, setMaxRetries] = useState(o.max_retries != null ? String(o.max_retries) : "");
  const [timeout, setTimeoutValue] = useState(o.timeout != null ? String(o.timeout) : "");
  const [priority, setPriority] = useState(o.priority != null ? String(o.priority) : "");
  const [paused, setPaused] = useState(o.paused ?? false);

  function buildPatch(): TaskOverridePatch | null {
    const patch: TaskOverridePatch = {};
    const numOr = (raw: string, name: keyof TaskOverridePatch) => {
      if (raw === "") {
        patch[name] = null as never;
      } else {
        const v = Number(raw);
        if (!Number.isFinite(v)) return false;
        (patch as Record<string, unknown>)[name] = v;
      }
      return true;
    };
    patch.rate_limit = rateLimit ? rateLimit : null;
    if (!numOr(maxConcurrent, "max_concurrent")) return null;
    if (!numOr(maxRetries, "max_retries")) return null;
    if (!numOr(timeout, "timeout")) return null;
    if (!numOr(priority, "priority")) return null;
    patch.paused = paused;
    return patch;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const patch = buildPatch();
    if (!patch) return;
    setOverride.mutate({ name: task.name, patch }, { onSuccess: () => onDone?.() });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">{task.name}</h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">Queue · {task.queue}</p>
      </div>
      <Tabs defaultValue="overrides">
        <TabsList>
          <TabsTrigger value="overrides">Overrides</TabsTrigger>
          <TabsTrigger value="middleware">Middleware</TabsTrigger>
        </TabsList>
        <TabsContent value="overrides">
          <OverrideForm
            task={task}
            onSubmit={onSubmit}
            rateLimit={rateLimit}
            setRateLimit={setRateLimit}
            maxConcurrent={maxConcurrent}
            setMaxConcurrent={setMaxConcurrent}
            maxRetries={maxRetries}
            setMaxRetries={setMaxRetries}
            timeoutValue={timeout}
            setTimeoutValue={setTimeoutValue}
            priority={priority}
            setPriority={setPriority}
            paused={paused}
            setPaused={setPaused}
            saving={setOverride.isPending}
            clearing={clearOverride.isPending}
            onClear={() => clearOverride.mutate(task.name, { onSuccess: () => onDone?.() })}
          />
        </TabsContent>
        <TabsContent value="middleware">
          <MiddlewareToggles taskName={task.name} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface OverrideFormProps {
  task: TaskEntry;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  rateLimit: string;
  setRateLimit: (v: string) => void;
  maxConcurrent: string;
  setMaxConcurrent: (v: string) => void;
  maxRetries: string;
  setMaxRetries: (v: string) => void;
  timeoutValue: string;
  setTimeoutValue: (v: string) => void;
  priority: string;
  setPriority: (v: string) => void;
  paused: boolean;
  setPaused: (v: boolean) => void;
  saving: boolean;
  clearing: boolean;
  onClear: () => void;
}

function OverrideForm({
  task,
  onSubmit,
  rateLimit,
  setRateLimit,
  maxConcurrent,
  setMaxConcurrent,
  maxRetries,
  setMaxRetries,
  timeoutValue,
  setTimeoutValue,
  priority,
  setPriority,
  paused,
  setPaused,
  saving,
  clearing,
  onClear,
}: OverrideFormProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 pt-4">
      <p className="text-[11px] text-[var(--fg-subtle)]">
        Overrides apply on the next worker restart; pausing takes effect immediately.
      </p>
      <NumberField
        id="o-rate-limit"
        label="Rate limit"
        value={rateLimit}
        onChange={setRateLimit}
        defaultValue={task.defaults.rate_limit ?? ""}
        type="text"
        placeholder="e.g. 100/m"
      />
      <NumberField
        id="o-max-concurrent"
        label="Max concurrent"
        value={maxConcurrent}
        onChange={setMaxConcurrent}
        defaultValue={
          task.defaults.max_concurrent != null ? String(task.defaults.max_concurrent) : ""
        }
        type="number"
      />
      <NumberField
        id="o-max-retries"
        label="Max retries"
        value={maxRetries}
        onChange={setMaxRetries}
        defaultValue={String(task.defaults.max_retries)}
        type="number"
      />
      <NumberField
        id="o-timeout"
        label="Timeout (s)"
        value={timeoutValue}
        onChange={setTimeoutValue}
        defaultValue={String(task.defaults.timeout)}
        type="number"
      />
      <NumberField
        id="o-priority"
        label="Priority"
        value={priority}
        onChange={setPriority}
        defaultValue={String(task.defaults.priority)}
        type="number"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
        Pause this task — new jobs will not be dequeued
      </label>
      <div className="mt-2 flex justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={clearing || !task.override}
          onClick={onClear}
        >
          <Trash2 aria-hidden /> Clear override
        </Button>
        <Button type="submit" disabled={saving}>
          <Save aria-hidden /> {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  defaultValue: string;
  type: "text" | "number";
  placeholder?: string;
}

function NumberField({ id, label, value, onChange, defaultValue, type, placeholder }: FieldProps) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? `Default: ${defaultValue || "—"}`}
      />
      {value !== "" ? (
        <span className="text-[11px] text-[var(--fg-subtle)]">
          Default: <code>{defaultValue || "—"}</code>
        </span>
      ) : null}
    </label>
  );
}
