import { randomUUID } from "node:crypto";
import type { Emitter, EventName, OutcomeEvent } from "../events";
import type { NativeQueue } from "../native";
import { Deliverer } from "./deliverer";
import { WebhookStore } from "./store";
import type { Delivery, Webhook, WebhookInput } from "./types";

const ALL_EVENTS: EventName[] = ["job.completed", "job.retrying", "job.dead", "job.cancelled"];
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Manages webhook subscriptions and delivers job events to them. */
export class WebhookManager {
  private readonly store: WebhookStore;
  private readonly deliverer = new Deliverer();
  private cache?: Webhook[];

  constructor(native: NativeQueue, emitter: Emitter) {
    this.store = new WebhookStore(native);
    for (const event of ALL_EVENTS) {
      emitter.on(event, (payload) => this.dispatch(event, payload));
    }
  }

  /** The event names a webhook can subscribe to. */
  eventTypes(): EventName[] {
    return [...ALL_EVENTS];
  }

  create(input: WebhookInput): Webhook {
    const now = Date.now();
    const webhook: Webhook = {
      id: randomUUID(),
      url: input.url,
      events: input.events ?? [],
      secret: input.secret,
      headers: input.headers ?? {},
      taskFilter: input.taskFilter,
      description: input.description,
      enabled: input.enabled ?? true,
      maxRetries: input.maxRetries ?? DEFAULT_MAX_RETRIES,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      createdAt: now,
      updatedAt: now,
    };
    this.store.put(webhook);
    this.cache = undefined;
    return webhook;
  }

  list(): Webhook[] {
    return this.store.list();
  }

  get(id: string): Webhook | undefined {
    return this.store.get(id);
  }

  update(id: string, patch: Partial<WebhookInput>): Webhook | undefined {
    const existing = this.store.get(id);
    if (!existing) {
      return undefined;
    }
    const updated: Webhook = {
      ...existing,
      ...patch,
      headers: patch.headers ?? existing.headers,
      updatedAt: Date.now(),
    };
    this.store.put(updated);
    this.cache = undefined;
    return updated;
  }

  delete(id: string): boolean {
    const removed = this.store.delete(id);
    this.cache = undefined;
    return removed;
  }

  deliveries(id: string): Delivery[] {
    return this.deliverer.recentFor(id);
  }

  /** Send a synthetic delivery to a webhook (used by the dashboard "test" action). */
  test(id: string): Promise<Delivery> | undefined {
    const webhook = this.store.get(id);
    if (!webhook) {
      return undefined;
    }
    return this.deliverer.deliver(webhook, "job.completed", { jobId: "test", taskName: "test" });
  }

  private dispatch(event: EventName, payload: OutcomeEvent): void {
    this.cache ??= this.store.list();
    for (const webhook of this.cache) {
      if (!webhook.enabled) {
        continue;
      }
      if (webhook.events.length > 0 && !webhook.events.includes(event)) {
        continue;
      }
      if (
        webhook.taskFilter &&
        webhook.taskFilter.length > 0 &&
        !webhook.taskFilter.includes(payload.taskName)
      ) {
        continue;
      }
      void this.deliverer.deliver(webhook, event, payload);
    }
  }
}
