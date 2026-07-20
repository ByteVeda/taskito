import { randomBytes, randomUUID } from "node:crypto";
import type { Emitter, EventName, OutcomeEvent } from "../events";
import type { NativeQueue } from "../native";
import { createLogger } from "../utils";
import { Deliverer } from "./deliverer";
import { type DeliveryFilters, DeliveryLog } from "./deliveryLog";
import { WebhookValidationError } from "./errors";
import { WebhookStore } from "./store";
import type { Delivery, Webhook, WebhookInput } from "./types";
import { assertSafeWebhookUrlSync } from "./urlSafety";

const ALL_EVENTS: EventName[] = ["job.completed", "job.retrying", "job.dead", "job.cancelled"];

const log = createLogger("webhooks");
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Reject misconfigured webhooks before they reach persistence. */
function validateWebhook(webhook: Webhook): void {
  if (!webhook.url) {
    throw new WebhookValidationError("webhook url is required");
  }
  // Registration is synchronous, so only the checks that need no DNS run here;
  // named hosts are resolved and re-checked on every delivery attempt.
  assertSafeWebhookUrlSync(webhook.url);
  if (!Number.isInteger(webhook.maxRetries) || webhook.maxRetries < 0) {
    throw new WebhookValidationError("webhook maxRetries must be a non-negative integer");
  }
  if (!Number.isFinite(webhook.timeoutMs) || webhook.timeoutMs <= 0) {
    throw new WebhookValidationError("webhook timeout must be a positive number");
  }
}

/** Manages webhook subscriptions and delivers job events to them. */
export class WebhookManager {
  private readonly store: WebhookStore;
  private readonly deliveryLog: DeliveryLog;
  private readonly deliverer = new Deliverer();
  private cache?: Webhook[];

  constructor(native: NativeQueue, emitter: Emitter) {
    this.store = new WebhookStore(native);
    this.deliveryLog = new DeliveryLog(native);
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
    validateWebhook(webhook);
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
    validateWebhook(updated);
    this.store.put(updated);
    this.cache = undefined;
    return updated;
  }

  delete(id: string): boolean {
    const removed = this.store.delete(id);
    this.deliveryLog.deleteFor(id);
    this.cache = undefined;
    return removed;
  }

  /** Replace the signing secret. Returns the new secret (shown exactly once). */
  rotateSecret(id: string): string | undefined {
    const existing = this.store.get(id);
    if (!existing) {
      return undefined;
    }
    const secret = randomBytes(32).toString("base64url");
    this.store.put({ ...existing, secret, updatedAt: Date.now() });
    this.cache = undefined;
    return secret;
  }

  /** Persisted deliveries for a webhook, newest first. */
  deliveries(id: string, filters?: DeliveryFilters): Delivery[] {
    return this.deliveryLog.listFor(id, filters);
  }

  delivery(id: string, deliveryId: string): Delivery | undefined {
    return this.deliveryLog.get(id, deliveryId);
  }

  deliveryCount(id: string): number {
    return this.deliveryLog.countFor(id);
  }

  /** Send a synthetic delivery to a webhook (used by the dashboard "test" action). */
  test(id: string): Promise<Delivery> | undefined {
    const webhook = this.store.get(id);
    if (!webhook) {
      return undefined;
    }
    return this.deliverer.deliver(webhook, "job.completed", { jobId: "test", taskName: "test" });
  }

  /**
   * Re-send a stored delivery's original payload as a fresh attempt. The
   * replay is logged as a NEW delivery record (tagged `replay_of`) so the
   * audit trail is preserved.
   */
  async replayDelivery(id: string, deliveryId: string): Promise<Delivery | undefined> {
    const webhook = this.store.get(id);
    const original = this.deliveryLog.get(id, deliveryId);
    if (!webhook || !original) {
      return undefined;
    }
    const payload = { ...original.payload, replay_of: original.id } as OutcomeEvent & {
      replay_of: string;
    };
    const delivery = await this.deliverer.deliver(webhook, original.event, payload);
    this.deliveryLog.record(delivery);
    return delivery;
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
      void this.deliverer
        .deliver(webhook, event, payload)
        .then((delivery) => this.deliveryLog.record(delivery))
        .catch((error) => {
          // A logging failure must never surface as an unhandled rejection.
          log.warn(() => `webhook delivery log write failed for ${webhook.id}`, error);
        });
    }
  }
}
