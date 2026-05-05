import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * Thin accent-colored bar pinned just below the header that fades in while
 * any TanStack Query is fetching or mutating. The bar lingers a beat after
 * activity stops so very fast refreshes still register visually rather than
 * flickering.
 */
export function TopProgressBar() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const busy = fetching > 0 || mutating > 0;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (busy) {
      setVisible(true);
      return;
    }
    const timeout = window.setTimeout(() => setVisible(false), 250);
    return () => window.clearTimeout(timeout);
  }, [busy]);

  return (
    <div aria-hidden className="sticky top-14 z-10 h-0.5 overflow-hidden bg-transparent">
      <div
        className={
          visible
            ? "h-full w-full bg-accent/70 transition-opacity duration-150 opacity-100"
            : "h-full w-full bg-accent/70 transition-opacity duration-300 opacity-0"
        }
      />
    </div>
  );
}
