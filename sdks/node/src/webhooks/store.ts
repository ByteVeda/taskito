import type { NativeQueue } from "../native";
import type { Webhook } from "./types";

const PREFIX = "webhook:";

/** Parse a persisted webhook, skipping corrupt records instead of throwing. */
function parse(raw: string): Webhook | undefined {
  try {
    return JSON.parse(raw) as Webhook;
  } catch {
    return undefined;
  }
}

/** Persists webhook subscriptions in the core key/value store. */
export class WebhookStore {
  constructor(private readonly native: NativeQueue) {}

  list(): Webhook[] {
    return Object.entries(this.native.listSettings())
      .filter(([key]) => key.startsWith(PREFIX))
      .map(([, value]) => parse(value))
      .filter((webhook): webhook is Webhook => webhook !== undefined);
  }

  get(id: string): Webhook | undefined {
    const raw = this.native.getSetting(PREFIX + id);
    return raw ? parse(raw) : undefined;
  }

  put(webhook: Webhook): void {
    this.native.setSetting(PREFIX + webhook.id, JSON.stringify(webhook));
  }

  delete(id: string): boolean {
    return this.native.deleteSetting(PREFIX + id);
  }
}
