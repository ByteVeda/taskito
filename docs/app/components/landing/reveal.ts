import { useEffect } from "react";

/** Scroll-reveal: add `.in` to `.reveal` elements as they enter the viewport. */
export function useReveal(): void {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".reveal:not(.in)");
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      for (const el of els) {
        el.classList.add("in");
      }
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i % 6, 5) * 0.04}s`;
      io.observe(el);
    });
    return () => io.disconnect();
  }, []);
}
