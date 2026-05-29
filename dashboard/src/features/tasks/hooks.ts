import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/api-client";
import {
  clearQueueOverride,
  clearTaskOverride,
  listQueues,
  listTasks,
  putQueueOverride,
  putTaskOverride,
} from "./api";
import type { QueueOverridePatch, TaskOverridePatch } from "./types";

const TASKS_KEY = ["tasks"] as const;
const QUEUES_KEY = ["queues-overrides"] as const;

function describeError(error: unknown): string | undefined {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return error.message;
  }
  return undefined;
}

export function tasksQuery() {
  return queryOptions({
    queryKey: TASKS_KEY,
    queryFn: ({ signal }) => listTasks(signal),
    // Task registry rarely changes between deploys.
    staleTime: 60_000,
  });
}

export function queuesQuery() {
  return queryOptions({
    queryKey: QUEUES_KEY,
    queryFn: ({ signal }) => listQueues(signal),
    staleTime: 60_000,
  });
}

export function useTasks() {
  return useQuery(tasksQuery());
}

export function useQueues() {
  return useQuery(queuesQuery());
}

export function useSetTaskOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, patch }: { name: string; patch: TaskOverridePatch }) =>
      putTaskOverride(name, patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: TASKS_KEY });
      toast.success("Override saved", {
        description: "Applied on next worker restart.",
      });
    },
    onError: (error) =>
      toast.error("Failed to save override", { description: describeError(error) }),
  });
}

export function useClearTaskOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => clearTaskOverride(name),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: TASKS_KEY });
      toast.success("Override cleared");
    },
    onError: (error) =>
      toast.error("Failed to clear override", { description: describeError(error) }),
  });
}

export function useSetQueueOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, patch }: { name: string; patch: QueueOverridePatch }) =>
      putQueueOverride(name, patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QUEUES_KEY });
      toast.success("Queue override saved");
    },
    onError: (error) =>
      toast.error("Failed to save queue override", { description: describeError(error) }),
  });
}

export function useClearQueueOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => clearQueueOverride(name),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QUEUES_KEY });
      toast.success("Queue override cleared");
    },
    onError: (error) =>
      toast.error("Failed to clear queue override", { description: describeError(error) }),
  });
}
