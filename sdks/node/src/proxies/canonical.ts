import { ProxyError } from "../errors";

/**
 * Canonical compact JSON with recursively sorted keys — the signing form of
 * the cross-SDK contract. Keys sort by UTF-16 code units; `undefined` object
 * values are dropped (wire peers have no undefined); non-safe-integer numbers
 * are rejected because their textual rendering is not stable across
 * implementations — encode decimals as strings.
 *
 * Hand-rolled rather than round-tripping through an object: JS objects
 * reorder integer-like keys numerically, which would diverge from the
 * contract's lexical ordering.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new ProxyError(
          `proxy reference numbers must be safe integers, got ${value} — encode decimals as strings`,
        );
      }
      return JSON.stringify(value);
    default:
      break;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  throw new ProxyError(`proxy reference values must be JSON-serializable, got ${typeof value}`);
}
