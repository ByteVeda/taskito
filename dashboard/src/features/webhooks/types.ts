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
