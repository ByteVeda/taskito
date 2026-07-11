/**
 * Structured task error per the cross-SDK binding contract: workers report
 * task failures as canonical JSON `{"errtype", "message", "traceback"}`.
 * Anything that doesn't parse as a JSON object with a string `message` key
 * (legacy strings, core-generated maintenance errors) must be shown as-is.
 */
export interface StructuredTaskError {
  errtype: string;
  message: string;
  traceback: string[];
}

/** Innermost frames carry the signal; cap so native tooltips stay readable. */
const TOOLTIP_TRACEBACK_FRAMES = 5;

/**
 * Parse an error string into its structured form, or `null` when it's a
 * plain legacy string that must render verbatim (the contract's fallback
 * rule: only a JSON object with a string `message` counts as structured).
 */
export function parseTaskError(raw: string | null | undefined): StructuredTaskError | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Cheap reject before JSON.parse — most legacy errors (tracebacks, core
  // maintenance strings) don't start with "{".
  if (!trimmed.startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.message !== "string") return null;

  // `errtype`/`traceback` are required by the contract but tolerated when
  // malformed — `message` alone decides structured-vs-legacy.
  return {
    errtype: typeof obj.errtype === "string" && obj.errtype ? obj.errtype : "Error",
    message: obj.message,
    traceback: Array.isArray(obj.traceback)
      ? obj.traceback.filter((frame): frame is string => typeof frame === "string")
      : [],
  };
}

/** One-line headline: `errtype: message`, or just `errtype` when message is empty. */
export function taskErrorSummary(error: StructuredTaskError): string {
  return error.message ? `${error.errtype}: ${error.message}` : error.errtype;
}

/** Tooltip text: the summary plus the tail of the traceback (innermost frames). */
export function taskErrorTooltip(error: StructuredTaskError): string {
  const summary = taskErrorSummary(error);
  if (error.traceback.length === 0) return summary;
  const frames = error.traceback.slice(-TOOLTIP_TRACEBACK_FRAMES);
  const ellipsis = frames.length < error.traceback.length ? "…\n" : "";
  return `${summary}\n\n${ellipsis}${frames.join("\n")}`;
}
