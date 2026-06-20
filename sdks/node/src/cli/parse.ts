/** Parsing helpers for CLI flags — fail fast with a clear message on bad input
 * instead of forwarding `NaN`/invalid values into queue APIs. */

/** Parse an optional finite-number flag; throws on non-numeric input. */
export function numberFlag(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} must be a number, got "${value}"`);
  }
  return parsed;
}

/** Parse an optional non-negative-integer flag (pagination, cutoffs). */
export function nonNegativeIntFlag(value: string | undefined, name: string): number | undefined {
  const parsed = numberFlag(value, name);
  if (parsed !== undefined && (!Number.isInteger(parsed) || parsed < 0)) {
    throw new Error(`--${name} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

/** Parse an optional positive-integer flag (pool/batch sizes). */
export function positiveIntFlag(value: string | undefined, name: string): number | undefined {
  const parsed = numberFlag(value, name);
  if (parsed !== undefined && (!Number.isInteger(parsed) || parsed <= 0)) {
    throw new Error(`--${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

/** Parse a JSON array of task args; throws if the JSON isn't an array. */
export function parseArgsArray(argsJson: string | undefined): unknown[] {
  if (argsJson === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch (error) {
    throw new Error(`args must be valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("args must be a JSON array, e.g. '[1, \"two\"]'");
  }
  return parsed;
}
