import type { EventName } from "../events";

/** Fields accepted when creating/updating a webhook subscription. */
export interface WebhookInput {
  url: string;
  /** Events to deliver. Empty/omitted = all events. */
  events?: EventName[];
  /** HMAC-SHA256 signing key. Sent as `X-Taskito-Signature: sha256=...`. */
  secret?: string;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Restrict to these task names. Empty/omitted = all tasks. */
  taskFilter?: string[];
  description?: string;
  enabled?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

/** A stored webhook subscription. */
export interface Webhook {
  id: string;
  url: string;
  events: EventName[];
  secret?: string;
  headers: Record<string, string>;
  taskFilter?: string[];
  description?: string;
  enabled: boolean;
  maxRetries: number;
  timeoutMs: number;
  createdAt: number;
  updatedAt: number;
}

/** The result of a single delivery attempt-chain. */
export interface Delivery {
  id: string;
  webhookId: string;
  event: EventName;
  status: number;
  ok: boolean;
  attempts: number;
  error?: string;
  at: number;
}
