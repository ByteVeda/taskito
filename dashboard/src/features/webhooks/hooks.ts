import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/api-client";
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listDeliveries,
  listEventTypes,
  listWebhooks,
  replayDelivery,
  rotateWebhookSecret,
  testWebhook,
  updateWebhook,
} from "./api";
import type { CreateWebhookInput, DeliveryStatus, UpdateWebhookInput, Webhook } from "./types";

const KEY = ["webhooks"] as const;
const EVENT_TYPES_KEY = ["webhooks", "event-types"] as const;

function describeError(error: unknown): string | undefined {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return error.message;
  }
  return undefined;
}

export function webhooksQuery() {
  return queryOptions({
    queryKey: KEY,
    queryFn: ({ signal }) => listWebhooks(signal),
  });
}

export function webhookQuery(id: string) {
  return queryOptions({
    queryKey: [...KEY, id],
    queryFn: ({ signal }) => getWebhook(id, signal),
  });
}

export function eventTypesQuery() {
  return queryOptions({
    queryKey: EVENT_TYPES_KEY,
    queryFn: ({ signal }) => listEventTypes(signal),
    staleTime: 5 * 60 * 1000,
  });
}

export function useWebhooks() {
  return useQuery(webhooksQuery());
}

export function useEventTypes() {
  return useQuery(eventTypesQuery());
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWebhookInput) => createWebhook(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success("Webhook created");
    },
    onError: (error) =>
      toast.error("Failed to create webhook", { description: describeError(error) }),
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWebhookInput }) =>
      updateWebhook(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Webhook[]>(KEY);
      if (prev) {
        qc.setQueryData<Webhook[]>(
          KEY,
          prev.map((w) => (w.id === id ? { ...w, ...input } : w)),
        );
      }
      return { prev };
    },
    onError: (error, _vars, context) => {
      if (context?.prev) qc.setQueryData(KEY, context.prev);
      toast.error("Failed to update webhook", { description: describeError(error) });
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWebhook(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success("Webhook deleted");
    },
    onError: (error) =>
      toast.error("Failed to delete webhook", { description: describeError(error) }),
  });
}

export function useRotateSecret() {
  return useMutation({
    mutationFn: (id: string) => rotateWebhookSecret(id),
    onError: (error) =>
      toast.error("Failed to rotate secret", { description: describeError(error) }),
  });
}

export function deliveriesQuery(
  subscriptionId: string,
  options: { status?: DeliveryStatus; limit?: number; offset?: number } = {},
) {
  return queryOptions({
    queryKey: [...KEY, subscriptionId, "deliveries", options] as const,
    queryFn: ({ signal }) => listDeliveries(subscriptionId, { ...options, signal }),
  });
}

export function useDeliveries(
  subscriptionId: string,
  options: { status?: DeliveryStatus; limit?: number; offset?: number } = {},
) {
  return useQuery(deliveriesQuery(subscriptionId, options));
}

export function useReplayDelivery(subscriptionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) => replayDelivery(subscriptionId, deliveryId),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: [...KEY, subscriptionId, "deliveries"] });
      if (result.delivered) {
        toast.success("Delivery replayed", {
          description: `Endpoint returned ${result.status}`,
        });
      } else {
        toast.error("Replay failed", {
          description: result.status
            ? `Endpoint returned ${result.status}`
            : "No response received from endpoint",
        });
      }
    },
    onError: (error) => toast.error("Replay failed", { description: describeError(error) }),
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: (id: string) => testWebhook(id),
    onSuccess: (result) => {
      if (result.delivered) {
        toast.success("Test event delivered", {
          description: `Endpoint returned ${result.status}`,
        });
      } else {
        toast.error("Test event failed", {
          description: result.status
            ? `Endpoint returned ${result.status}`
            : "No response received from endpoint",
        });
      }
    },
    onError: (error) => toast.error("Test event failed", { description: describeError(error) }),
  });
}
