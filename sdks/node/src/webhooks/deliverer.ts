import { createHmac, randomUUID } from "node:crypto";
import type { EventName, OutcomeEvent } from "../events";
import { createLogger } from "../utils";
import type { Delivery, Webhook } from "./types";

const MAX_RECENT = 100;
const MAX_BACKOFF_MS = 30_000;
const MAX_RESPONSE_BODY_CHARS = 2048;

const log = createLogger("webhooks");

/** Signs and POSTs webhook payloads with retries; keeps a recent-delivery log. */
export class Deliverer {
  private readonly recent: Delivery[] = [];

  recentFor(webhookId: string): Delivery[] {
    return this.recent.filter((delivery) => delivery.webhookId === webhookId);
  }

  async deliver(webhook: Webhook, event: EventName, payload: OutcomeEvent): Promise<Delivery> {
    const payloadRecord: Record<string, unknown> = { event, ...payload };
    const body = JSON.stringify(payloadRecord);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...webhook.headers,
    };
    if (webhook.secret) {
      const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");
      headers["x-taskito-signature"] = `sha256=${signature}`;
    }

    const createdAt = Date.now();
    let attempts = 0;
    let responseCode: number | null = null;
    let responseBody: string | null = null;
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
        responseCode = response.status;
        responseBody = await readBody(response);
        if (response.ok) {
          error = undefined;
          break;
        }
        error = `HTTP ${response.status}`;
      } catch (cause) {
        responseCode = null;
        responseBody = null;
        error = cause instanceof Error ? cause.message : String(cause);
      }
      if (attempts <= webhook.maxRetries) {
        await sleep(backoff(attempts));
      }
    }

    const completedAt = Date.now();
    const ok = responseCode !== null && responseCode >= 200 && responseCode < 300;
    const delivery: Delivery = {
      id: randomUUID(),
      webhookId: webhook.id,
      event,
      // The retry chain is inline, so a non-delivered outcome is `dead`.
      status: ok ? "delivered" : "dead",
      ok,
      attempts,
      payload: payloadRecord,
      taskName: payload.taskName ?? null,
      jobId: payload.jobId ?? null,
      responseCode,
      responseBody,
      latencyMs: completedAt - createdAt,
      error,
      createdAt,
      completedAt,
    };
    this.recent.push(delivery);
    if (this.recent.length > MAX_RECENT) {
      this.recent.shift();
    }
    if (!delivery.ok) {
      log.warn(
        () =>
          `delivery of ${event} to ${redactUrl(webhook.url)} failed after ${attempts} attempt(s): ${error}`,
      );
    }
    return delivery;
  }
}

/** Read a response body for the delivery log, truncated; `null` if unreadable. */
async function readBody(response: Response): Promise<string | null> {
  try {
    return (await response.text()).slice(0, MAX_RESPONSE_BODY_CHARS);
  } catch {
    return null;
  }
}

/** Strip credentials and query string from a URL before logging it. */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 500 * 2 ** (attempt - 1));
}
