// Dashboard settings (key/value config) route handlers. Values are opaque
// strings to the storage layer; the SPA stores JSON blobs (branding,
// integrations, external links).

import type { Queue } from "../../index";
import { BadRequestError, NotFoundError } from "../errors";

const MAX_KEY_LENGTH = 256;
const MAX_VALUE_LENGTH = 64 * 1024; // 64 KiB — enough for any dashboard config blob

// Internal namespaces that must never be exposed or mutated through the
// public settings API. `auth:` holds password hashes and live sessions
// (reading or overwriting these is a full auth bypass); `webhook`-prefixed
// keys hold subscription rows with plaintext HMAC secrets plus delivery
// logs. Protected keys are treated as absent.
const PROTECTED_PREFIXES = ["auth:", "webhooks:", "webhook:"];

const isProtected = (key: string): boolean => PROTECTED_PREFIXES.some((p) => key.startsWith(p));

function validateKey(key: string): void {
  if (!key) {
    throw new BadRequestError("setting key must not be empty");
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new BadRequestError(`setting key exceeds ${MAX_KEY_LENGTH} characters`);
  }
  if ([...key].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
    throw new BadRequestError("setting key must not contain control characters");
  }
  if (isProtected(key)) {
    throw new BadRequestError("setting key is reserved");
  }
}

/** All settings as `{key: value}`, minus protected namespaces. */
export function listSettings(queue: Queue): Record<string, string> {
  return Object.fromEntries(
    Object.entries(queue.listSettings()).filter(([key]) => !isProtected(key)),
  );
}

/** A single setting, or 404. Protected keys read as absent. */
export function getSetting(queue: Queue, key: string) {
  if (isProtected(key)) {
    throw new NotFoundError(`setting '${key}' not found`);
  }
  const value = queue.getSetting(key);
  if (value === null) {
    throw new NotFoundError(`setting '${key}' not found`);
  }
  return { key, value };
}

/** Insert or update a setting from a `PUT` body of `{"value": ...}`. */
export function putSetting(queue: Queue, key: string, body: unknown) {
  validateKey(key);
  if (!body || typeof body !== "object" || !("value" in body)) {
    throw new BadRequestError("body must be a JSON object with a 'value' field");
  }
  const raw = (body as { value: unknown }).value;
  // Accept any JSON-serialisable type — re-encode for storage so callers
  // don't need to stringify themselves.
  const value = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (Buffer.byteLength(value, "utf8") > MAX_VALUE_LENGTH) {
    throw new BadRequestError(`setting value exceeds ${MAX_VALUE_LENGTH} bytes`);
  }
  queue.setSetting(key, value);
  return { key, value };
}

/** Delete a setting. Returns `{deleted: bool}`. Protected keys read as absent. */
export function deleteSetting(queue: Queue, key: string) {
  if (isProtected(key)) {
    throw new NotFoundError(`setting '${key}' not found`);
  }
  return { deleted: queue.deleteSetting(key) };
}
