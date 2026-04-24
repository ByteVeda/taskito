import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRefreshInterval } from "@/providers/refresh-interval-provider";
import { fetchPausedQueues, fetchQueueStats, pauseQueue, resumeQueue } from "./api";

const KEY = {
  stats: ["queues", "stats"] as const,
  paused: ["queues", "paused"] as const,
  all: ["queues"] as const,
};

export function useQueueStats() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: KEY.stats,
    queryFn: ({ signal }) => fetchQueueStats(signal),
    refetchInterval: intervalMs,
  });
}

export function usePausedQueues() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: KEY.paused,
    queryFn: ({ signal }) => fetchPausedQueues(signal),
    refetchInterval: intervalMs,
  });
}

interface OptimisticContext {
  prev: string[] | undefined;
}

/**
 * Pause a queue.
 *
 * Optimistically adds the queue name to the paused set so the UI reflects
 * the change instantly; rolls back on error.
 */
export function usePauseQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => pauseQueue(name),
    onMutate: async (name) => {
      await qc.cancelQueries({ queryKey: KEY.paused });
      const prev = qc.getQueryData<string[]>(KEY.paused);
      qc.setQueryData<string[]>(KEY.paused, [...(prev ?? []), name]);
      return { prev } satisfies OptimisticContext;
    },
    onError: (error, _name, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(KEY.paused, ctx.prev);
      toast.error("Couldn't pause queue", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSuccess: (result) => toast.success(`Paused ${result.paused}`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY.all }),
  });
}

/**
 * Resume a paused queue. Mirrors `usePauseQueue` with an inverted optimistic
 * update.
 */
export function useResumeQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => resumeQueue(name),
    onMutate: async (name) => {
      await qc.cancelQueries({ queryKey: KEY.paused });
      const prev = qc.getQueryData<string[]>(KEY.paused);
      qc.setQueryData<string[]>(
        KEY.paused,
        (prev ?? []).filter((n) => n !== name),
      );
      return { prev } satisfies OptimisticContext;
    },
    onError: (error, _name, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(KEY.paused, ctx.prev);
      toast.error("Couldn't resume queue", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSuccess: (result) => toast.success(`Resumed ${result.resumed}`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY.all }),
  });
}
