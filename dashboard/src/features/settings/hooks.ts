import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteSetting, fetchSettings, setSetting } from "./api";
import type { SettingsSnapshot } from "./types";

const KEY = ["settings"] as const;

export function settingsQuery() {
  return queryOptions({
    queryKey: KEY,
    queryFn: ({ signal }) => fetchSettings(signal),
  });
}

export function useSettings() {
  return useQuery(settingsQuery());
}

interface UpdateInput {
  key: string;
  value: unknown;
}

/**
 * Optimistically update a setting in the cache, then sync with the server.
 * Rolls back on error to keep the UI consistent.
 */
export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: UpdateInput) => setSetting(key, value),
    onMutate: async ({ key, value }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<SettingsSnapshot>(KEY);
      const encoded = typeof value === "string" ? value : JSON.stringify(value);
      qc.setQueryData<SettingsSnapshot>(KEY, { ...(prev ?? {}), [key]: encoded });
      return { prev };
    },
    onError: (error, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast.error("Couldn't save setting", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSuccess: () => toast.success("Setting saved"),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => deleteSetting(key),
    onMutate: async (key) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<SettingsSnapshot>(KEY);
      if (prev) {
        const next = { ...prev };
        delete next[key];
        qc.setQueryData<SettingsSnapshot>(KEY, next);
      }
      return { prev };
    },
    onError: (error, _key, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast.error("Couldn't delete setting", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
