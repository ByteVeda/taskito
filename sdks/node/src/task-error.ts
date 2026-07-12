/**
 * Canonical structured task-error format (cross-SDK contract).
 *
 * A failed task is stored as one JSON object — `{"errtype", "message",
 * "traceback"}` in that key order — so any SDK can read another's failures.
 * Plain strings (core maintenance errors, legacy rows) stay untouched;
 * readers fall back via {@link decodeTaskError} returning null.
 */

/** A decoded structured task error. */
export interface TaskError {
  errtype: string;
  message: string;
  traceback: string[];
}

/** Encode a thrown value as the canonical cross-SDK error JSON. */
export function encodeTaskError(error: unknown): string {
  let errtype = "Error";
  let message: string;
  let traceback: string[] = [];
  if (error instanceof Error) {
    // Prefer the runtime class name: `error.name` stays "Error" for subclasses
    // that don't override it, collapsing distinct types to the generic value.
    errtype = error.constructor?.name || error.name || "Error";
    message = error.message ?? String(error);
    // Keep stack lines verbatim — readers render them as-is.
    traceback = error.stack ? error.stack.split("\n") : [];
  } else {
    message = String(error);
  }
  // Object-literal key order is the contract's key order.
  return JSON.stringify({ errtype, message, traceback });
}

/**
 * Decode a stored error string. Returns null when it is not a structured
 * error (the contract's fallback rule: not a JSON object with a string
 * `message`), in which case callers surface the raw string unchanged.
 */
export function decodeTaskError(raw: string): TaskError | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.message !== "string") {
    return null;
  }
  return {
    errtype: typeof candidate.errtype === "string" ? candidate.errtype : "Error",
    message: candidate.message,
    traceback: Array.isArray(candidate.traceback)
      ? candidate.traceback.filter((line): line is string => typeof line === "string")
      : [],
  };
}
