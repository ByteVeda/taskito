import { api } from "@/lib/api-client";
import type {
  CreateWebhookInput,
  DeliveryListPage,
  DeliveryStatus,
  ReplayDeliveryResult,
  RotateSecretResult,
  TestWebhookResult,
  UpdateWebhookInput,
  Webhook,
  WebhookDelivery,
} from "./types";

export function listWebhooks(signal?: AbortSignal): Promise<Webhook[]> {
  return api.get<Webhook[]>("/api/webhooks", { signal });
}

export function getWebhook(id: string, signal?: AbortSignal): Promise<Webhook> {
  return api.get<Webhook>(`/api/webhooks/${id}`, { signal });
}

export function createWebhook(input: CreateWebhookInput): Promise<Webhook> {
  return api.post<Webhook>("/api/webhooks", input);
}

export function updateWebhook(id: string, input: UpdateWebhookInput): Promise<Webhook> {
  return api.put<Webhook>(`/api/webhooks/${id}`, input);
}

export function deleteWebhook(id: string): Promise<{ deleted: true }> {
  return api.delete<{ deleted: true }>(`/api/webhooks/${id}`);
}

export function rotateWebhookSecret(id: string): Promise<RotateSecretResult> {
  return api.post<RotateSecretResult>(`/api/webhooks/${id}/rotate-secret`);
}

export function testWebhook(id: string): Promise<TestWebhookResult> {
  return api.post<TestWebhookResult>(`/api/webhooks/${id}/test`);
}

export function listEventTypes(signal?: AbortSignal): Promise<string[]> {
  return api.get<string[]>("/api/event-types", { signal });
}

export function listDeliveries(
  subscriptionId: string,
  options: { status?: DeliveryStatus; limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<DeliveryListPage> {
  return api.get<DeliveryListPage>(`/api/webhooks/${subscriptionId}/deliveries`, {
    signal: options.signal,
    params: {
      status: options.status,
      limit: options.limit,
      offset: options.offset,
    },
  });
}

export function getDelivery(
  subscriptionId: string,
  deliveryId: string,
  signal?: AbortSignal,
): Promise<WebhookDelivery> {
  return api.get<WebhookDelivery>(`/api/webhooks/${subscriptionId}/deliveries/${deliveryId}`, {
    signal,
  });
}

export function replayDelivery(
  subscriptionId: string,
  deliveryId: string,
): Promise<ReplayDeliveryResult> {
  return api.post<ReplayDeliveryResult>(
    `/api/webhooks/${subscriptionId}/deliveries/${deliveryId}/replay`,
  );
}
