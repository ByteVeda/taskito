import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api/client";
import { markRefreshed, refreshInterval } from "./use-auto-refresh";

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApi<T>(url: string | null, deps: unknown[] = []): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading((prev) => (data === null ? true : prev));

    api<T>(url, controller.signal)
      .then((result) => {
        if (mountedRef.current && !controller.signal.aborted) {
          setData(result);
          setError(null);
          setLoading(false);
          markRefreshed();
        }
      })
      .catch((err) => {
        if (mountedRef.current && !controller.signal.aborted) {
          setError(err.message ?? "Failed to fetch");
          setLoading(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    const ms = refreshInterval.value;
    if (ms <= 0 || !url) return;
    const timer = setInterval(fetchData, ms);
    return () => clearInterval(timer);
  }, [fetchData, url, refreshInterval.value]);

  return { data, loading, error, refetch: fetchData };
}
