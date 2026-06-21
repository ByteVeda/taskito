import { useEffect, useRef, useState } from "react";
import { useThemeMode } from "@/lib/theme";

/** A live demo the finder can open: the embed id + a human title for the bar. */
export interface DemoTarget {
  /** Demo id understood by `demos/interactive.html?embed=` (e.g. "ratelimit"). */
  id: string;
  /** Title shown in the modal bar. */
  title: string;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
}

const PLAY_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m8 5 11 7-11 7V5z" />
  </svg>
);

const CLOSE_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

/**
 * Centered overlay that opens a finder scenario's live demo in an `<iframe>`,
 * pointed at the vendored `demos/interactive.html` embed mode (theme inherited
 * from the host). React port of `INTEGRATION-scenario-finder.md` §6: focus moves
 * to the close button on open and restores on close, Escape + backdrop close,
 * background scroll is locked, and the enter transition is motion-aware.
 *
 * `demo === null` keeps the modal closed; a brief exit transition plays before
 * the iframe unmounts so the demo stops running.
 */
export function DemoModal({
  demo,
  onClose,
}: {
  demo: DemoTarget | null;
  onClose: () => void;
}) {
  const theme = useThemeMode();
  // Mounted target (survives the exit transition after `demo` goes null).
  const [current, setCurrent] = useState<DemoTarget | null>(demo);
  // Drives the `.open` class — toggled a frame after mount so the enter plays.
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (demo) {
      restoreRef.current = (document.activeElement as HTMLElement) ?? null;
      setCurrent(demo);
      setLoading(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const timer = setTimeout(
      () => setCurrent(null),
      prefersReducedMotion() ? 0 : 260,
    );
    return () => clearTimeout(timer);
  }, [demo]);

  // While a demo is mounted: lock scroll and close on Escape.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [current, onClose]);

  // Move focus into the dialog on open; restore it to the trigger on close.
  useEffect(() => {
    if (shown) closeRef.current?.focus();
  }, [shown]);
  useEffect(() => {
    if (!current && restoreRef.current) {
      restoreRef.current.focus?.();
      restoreRef.current = null;
    }
  }, [current]);

  if (!current) return null;

  // `import.meta.env.BASE_URL` ends with "/" and respects DOCS_BASE_PATH.
  const src = `${import.meta.env.BASE_URL}demos/interactive.html?embed=${current.id}&theme=${theme}&accent=brand#${current.id}`;

  return (
    <div className={`dm-overlay${shown ? " open" : ""}`} aria-hidden={!shown}>
      <button
        type="button"
        className="dm-backdrop"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        className="dm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-title"
      >
        <div className="dm-bar">
          <span className="dm-mark">{PLAY_ICON}</span>
          <div className="dm-meta">
            <span className="dm-eyebrow">Live demo</span>
            <span className="dm-title" id="dm-title">
              {current.title}
            </span>
          </div>
          <div className="dm-actions">
            <button
              type="button"
              className="dm-x"
              ref={closeRef}
              onClick={onClose}
              aria-label="Close demo"
            >
              {CLOSE_ICON}
            </button>
          </div>
        </div>
        <div className="dm-stage">
          <div className={`dm-loading${loading ? "" : " hide"}`}>
            <span className="dm-spin" />
            Loading demo…
          </div>
          <iframe
            className="dm-frame"
            title={`${current.title} — interactive demo`}
            src={src}
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>
    </div>
  );
}
