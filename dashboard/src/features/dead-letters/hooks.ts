import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { useRefreshInterval } from "@/providers";
import { deleteDeadLetter, fetchDeadLetters, purgeDeadLetters, retryDeadLetter } from "./api";

const KEY = {
  all: ["dead-letters"] as const,
  list: (page: number, pageSize: number) => ["dead-letters", "list", page, pageSize] as const,
};

export function deadLettersQuery(page: number, pageSize: number) {
  return queryOptions({
    queryKey: KEY.list(page, pageSize),
    queryFn: ({ signal }) => fetchDeadLetters(page, pageSize, signal),
    placeholderData: keepPreviousData,
  });
}

export function useDeadLetters(page: number, pageSize: number) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...deadLettersQuery(page, pageSize), refetchInterval: intervalMs });
}

export function useRetryDeadLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retryDeadLetter(id),
    onError: (error) => {
      toast.error("Couldn't retry dead letter", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSuccess: (result) => {
      toast.success("Re-enqueued", {
        description: `New job: ${result.new_job_id.slice(0, 8)}…`,
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY.all });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useDeleteDeadLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDeadLetter(id),
    onError: (error) => {
      toast.error("Couldn't discard dead letter", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSuccess: (result) => {
      if (result.deleted) {
        toast.success("Dead letter discarded");
      } else {
        toast.message("Dead letter already removed");
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY.all });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function usePurgeDeadLetters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => purgeDeadLetters(),
    onError: (error) => {
      toast.error("Couldn't purge dead letters", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSuccess: (result) => {
      toast.success("Dead letters purged", {
        description: `${result.purged} entries removed`,
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY.all });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
