import { createHmac, randomUUID } from "node:crypto";
import type { EventName, OutcomeEvent } from "../events";
import type { Delivery, Webhook } from "./types";

const MAX_RECENT = 100;
const MAX_BACKOFF_MS = 30_000;

/** Signs and POSTs webhook payloads with retries; keeps a recent-delivery log. */
export class Deliverer {
  private readonly recent: Delivery[] = [];

  recentFor(webhookId: string): Delivery[] {
    return this.recent.filter((delivery) => delivery.webhookId === webhookId);
  }

  async deliver(webhook: Webhook, event: EventName, payload: OutcomeEvent): Promise<Delivery> {
    const body = JSON.stringify({ event, ...payload });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...webhook.headers,
    };
    if (webhook.secret) {
      const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");
      headers["x-taskito-signature"] = `sha256=${signature}`;
    }

    let attempts = 0;
    let status = 0;
    let error: string | undefined;
    while (attempts <= webhook.maxRetries) {
      attempts += 1;
      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(webhook.timeoutMs),
        });
        status = response.status;
        if (response.ok) {
          error = undefined;
          break;
        }
        error = `HTTP ${response.status}`;
      } catch (cause) {
        status = 0;
        error = cause instanceof Error ? cause.message : String(cause);
      }
      if (attempts <= webhook.maxRetries) {
        await sleep(backoff(attempts));
      }
    }

    const delivery: Delivery = {
      id: randomUUID(),
      webhookId: webhook.id,
      event,
      status,
      ok: status >= 200 && status < 300,
      attempts,
      error,
      at: Date.now(),
    };
    this.recent.push(delivery);
    if (this.recent.length > MAX_RECENT) {
      this.recent.shift();
    }
    return delivery;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 500 * 2 ** (attempt - 1));
}
