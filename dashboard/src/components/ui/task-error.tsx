import { cn } from "@/lib/cn";
import { parseTaskError, taskErrorSummary, taskErrorTooltip } from "@/lib/task-error";

/**
 * Full task-error block for detail views. Structured errors get an
 * `errtype: message` headline plus the traceback; legacy strings render
 * verbatim. `className` carries per-site sizing/background (max-h, bg,
 * padding) so each call site keeps its existing look.
 */
export function TaskErrorBlock({ error, className }: { error: string; className?: string }) {
  const parsed = parseTaskError(error);

  if (!parsed) {
    return (
      <pre
        className={cn(
          "overflow-auto whitespace-pre-wrap rounded-md font-mono text-[11px] text-danger",
          className,
        )}
      >
        {error}
      </pre>
    );
  }

  return (
    <div className={cn("overflow-auto rounded-md font-mono text-[11px] text-danger", className)}>
      <div className="font-semibold">{taskErrorSummary(parsed)}</div>
      {parsed.traceback.length > 0 ? (
        <pre className="mt-2 whitespace-pre-wrap">{parsed.traceback.join("\n")}</pre>
      ) : null}
    </div>
  );
}

/**
 * One-line task-error for table cells: structured → `errtype: message` with
 * the traceback tail in the title tooltip; legacy → the raw string with the
 * full text as title (the pre-existing behavior).
 */
export function TaskErrorSummary({ error, className }: { error: string; className?: string }) {
  const parsed = parseTaskError(error);
  const text = parsed ? taskErrorSummary(parsed) : error;
  const title = parsed ? taskErrorTooltip(parsed) : error;
  return (
    <span className={className} title={title}>
      {text}
    </span>
  );
}
