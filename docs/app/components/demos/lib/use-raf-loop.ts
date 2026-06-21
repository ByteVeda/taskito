import { useEffect, useRef } from "react";

/**
 * Run `callback` once per animation frame while `active` is true, passing the
 * high-resolution timestamp. The loop is fully torn down (no dangling frame)
 * when `active` flips false or the component unmounts, so a closed demo modal
 * never leaves a RAF running.
 *
 * `callback` is held in a ref, so a demo can pass a fresh closure each render
 * without restarting the loop.
 */
export function useRafLoop(
  callback: (now: number) => void,
  active: boolean,
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const tick = (now: number) => {
      cbRef.current(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);
}
