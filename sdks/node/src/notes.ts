import { NotesValidationError } from "./errors";

/** Max top-level fields in a notes object (matches the storage contract). */
const MAX_FIELDS = 15;
/** Max encoded size of a notes object in bytes. */
const MAX_BYTES = 4096;

/**
 * Validate structured job notes against the storage contract and return their
 * canonical JSON encoding. Bounds: at most {@link MAX_FIELDS} top-level fields
 * and {@link MAX_BYTES} bytes encoded. Throws {@link TaskitoError} on violation.
 */
export function encodeNotes(notes: Record<string, unknown>): string {
  const fields = Object.keys(notes).length;
  if (fields > MAX_FIELDS) {
    throw new NotesValidationError(`notes: at most ${MAX_FIELDS} top-level fields (got ${fields})`);
  }
  const encoded = JSON.stringify(notes);
  const bytes = Buffer.byteLength(encoded, "utf8");
  if (bytes > MAX_BYTES) {
    throw new NotesValidationError(`notes: encoded size ${bytes} exceeds ${MAX_BYTES} bytes`);
  }
  return encoded;
}
