// Per-task middleware disable list. Persisted under
// `middleware:disabled:<task_name>` as a JSON array of middleware names and
// read at every invocation, so toggles take effect on the next job without
// a worker restart.

import type { Middleware } from "../middleware";
import { createLogger } from "../utils";
import type { SettingsAccess } from "./overridesStore";

const DISABLE_PREFIX = "middleware:disabled:";

const log = createLogger("dashboard");

/** The stable name a middleware is keyed on in the disable list. */
export function middlewareKey(middleware: Middleware, index: number): string {
  const named = (middleware as { name?: unknown }).name;
  if (typeof named === "string" && named) {
    return named;
  }
  const className = middleware.constructor?.name;
  if (className && className !== "Object") {
    return className;
  }
  return `middleware:${index}`;
}

function parse(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter((x): x is string => typeof x === "string") : [];
  } catch {
    log.warn(() => "middleware disable list is not valid JSON; treating as empty");
    return [];
  }
}

/** List/set/clear per-task middleware disables. */
export class MiddlewareDisableStore {
  constructor(private readonly settings: SettingsAccess) {}

  private key(taskName: string): string {
    return DISABLE_PREFIX + taskName;
  }

  /** `{task_name: [disabled...]}` for every task with at least one disable. */
  listAll(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [key, raw] of Object.entries(this.settings.listSettings())) {
      if (!key.startsWith(DISABLE_PREFIX)) {
        continue;
      }
      const names = parse(raw);
      if (names.length > 0) {
        out[key.slice(DISABLE_PREFIX.length)] = names;
      }
    }
    return out;
  }

  getFor(taskName: string): string[] {
    return parse(this.settings.getSetting(this.key(taskName)));
  }

  /** Flip a middleware on/off for a task; returns the new disable list. */
  setDisabled(taskName: string, middlewareName: string, disabled: boolean): string[] {
    if (!taskName) {
      throw new Error("task_name must not be empty");
    }
    if (!middlewareName) {
      throw new Error("middleware name must not be empty");
    }
    let current = this.getFor(taskName);
    if (disabled) {
      if (!current.includes(middlewareName)) {
        current.push(middlewareName);
      }
    } else {
      current = current.filter((n) => n !== middlewareName);
    }
    if (current.length > 0) {
      this.settings.setSetting(this.key(taskName), JSON.stringify(current));
    } else {
      this.settings.deleteSetting(this.key(taskName));
    }
    return current;
  }

  clearFor(taskName: string): boolean {
    return this.settings.deleteSetting(this.key(taskName));
  }
}
