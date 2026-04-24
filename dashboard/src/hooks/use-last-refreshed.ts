import { useIsFetching } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * Tracks the timestamp of the last moment no queries were actively fetching,
 * providing an approximate "last refreshed at" time for the dashboard.
 */
export function useLastRefreshed(): { lastRefreshedAt: number; isFetching: boolean } {
  const fetching = useIsFetching();
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(() => Date.now());

  useEffect(() => {
    if (fetching === 0) setLastRefreshedAt(Date.now());
  }, [fetching]);

  return { lastRefreshedAt, isFetching: fetching > 0 };
}
