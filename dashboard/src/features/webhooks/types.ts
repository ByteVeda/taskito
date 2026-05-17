/**
 * Shape of a persisted webhook subscription returned by the dashboard API.
 *
 * The ``secret`` field is only present on the response to the *create* and
 * *rotate-secret* endpoints — every other endpoint redacts it and exposes
 * only ``has_secret`` so the raw value can't leak in repeated reads.
 */
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  task_filter: string[] | null;
  headers: Record<string, string>;
  has_secret: boolean;
  secret?: string;
  max_retries: number;
  timeout_seconds: number;
  retry_backoff: number;
  enabled: boolean;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateWebhookInput {
  url: string;
  events?: string[];
  task_filter?: string[] | null;
  headers?: Record<string, string>;
  secret?: string | null;
  generate_secret?: boolean;
  max_retries?: number;
  timeout_seconds?: number;
  retry_backoff?: number;
  description?: string | null;
}

export type UpdateWebhookInput = Partial<
  Pick<
    Webhook,
    | "url"
    | "events"
    | "task_filter"
    | "headers"
    | "max_retries"
    | "timeout_seconds"
    | "retry_backoff"
    | "enabled"
    | "description"
  >
>;

export interface TestWebhookResult {
  status: number | null;
  delivered: boolean;
}

export interface RotateSecretResult {
  id: string;
  secret: string;
}

export type DeliveryStatus = "delivered" | "failed" | "dead" | "pending";

export interface WebhookDelivery {
  id: string;
  subscription_id: string;
  event: string;
  payload: Record<string, unknown>;
  task_name: string | null;
  job_id: string | null;
  status: DeliveryStatus;
  attempts: number;
  response_code: number | null;
  response_body: string | null;
  latency_ms: number | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface DeliveryListPage {
  items: WebhookDelivery[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReplayDeliveryResult {
  replayed_of: string;
  status: number | null;
  delivered: boolean;
}
