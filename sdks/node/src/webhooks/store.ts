import type { NativeQueue } from "../native";
import type { Webhook } from "./types";

const PREFIX = "webhook:";

/** Persists webhook subscriptions in the core key/value store. */
export class WebhookStore {
  constructor(private readonly native: NativeQueue) {}

  list(): Webhook[] {
    return Object.entries(this.native.listSettings())
      .filter(([key]) => key.startsWith(PREFIX))
      .map(([, value]) => JSON.parse(value) as Webhook);
  }

  get(id: string): Webhook | undefined {
    const raw = this.native.getSetting(PREFIX + id);
    return raw ? (JSON.parse(raw) as Webhook) : undefined;
  }

  put(webhook: Webhook): void {
    this.native.setSetting(PREFIX + webhook.id, JSON.stringify(webhook));
  }

  delete(id: string): boolean {
    return this.native.deleteSetting(PREFIX + id);
  }
}
