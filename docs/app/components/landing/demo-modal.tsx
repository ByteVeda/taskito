import { Suspense, useEffect, useRef, useState } from "react";
import { demoComponent } from "@/components/demos";
import { useThemeMode } from "@/lib/theme";

/** A live demo the finder can open: the demo id + a human title for the bar. */
export interface DemoTarget {
  /** Demo id — a React port (see demos/registry) or an iframe fallback id. */
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
 * Centered overlay that opens a finder scenario's live demo — a lazy-loaded
 * React component resolved from the demo registry (theme inherited from the
 * host). Focus moves to the close button on open and restores on close,
 * Escape + backdrop close, background scroll is locked, Tab focus is trapped,
 * and the enter transition is motion-aware.
 *
 * `demo === null` keeps the modal closed; a brief exit transition plays before
 * the demo unmounts so its animation loop stops.
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
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (demo) {
      restoreRef.current = (document.activeElement as HTMLElement) ?? null;
      setCurrent(demo);
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

  // While a demo is mounted: lock scroll, close on Escape, and trap Tab focus
  // inside the dialog so keyboard users can't reach background content.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
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

  const Demo = demoComponent(current.id);

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
        ref={dialogRef}
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
          <Suspense
            fallback={
              <div className="dm-loading">
                <span className="dm-spin" />
                Loading demo…
              </div>
            }
          >
            {Demo ? <Demo theme={theme} /> : null}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
