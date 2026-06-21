import { useEffect } from "react";
import { prefetchSdkDocs } from "@/lib/prefetch";
import { useActiveSdk } from "./use-sdk";

/**
 * Warm the active SDK's docs in the background. Runs on mount and whenever the
 * selected language changes (hero tab, sidebar switcher, or a `/node|/python`
 * URL), so the first navigation into that SDK's docs is instant.
 */
export function usePrefetchDocs(): void {
  const sdk = useActiveSdk();
  useEffect(() => {
    prefetchSdkDocs(sdk);
  }, [sdk]);
}
