import { useIsMutating } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * Thin accent-colored bar that fades in while a mutation (user action)
 * is in flight. Polling refetches do not trigger it — at low polling
 * intervals a per-fetch indicator strobes and reads as visual jitter.
 * The "Updated just now" label in the header already conveys refresh
 * cadence, so the progress bar focuses on intentional state changes.
 */
export function TopProgressBar() {
  const mutating = useIsMutating();
  const busy = mutating > 0;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (busy) {
      setVisible(true);
      return;
    }
    const timeout = window.setTimeout(() => setVisible(false), 400);
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
