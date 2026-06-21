"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";

type DiagramSlideProps = {
  title?: string;
  children: ReactNode;
};

export function DiagramSlide({ children }: DiagramSlideProps) {
  return <>{children}</>;
}

type SlideElement = ReactElement<DiagramSlideProps>;

export function DiagramCarousel({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  const slides = Children.toArray(children).filter(
    (child): child is SlideElement => isValidElement(child),
  );
  const total = slides.length;
  const containerRef = useRef<HTMLElement | null>(null);
  const [index, setIndex] = useState(0);

  const prev = useCallback(
    () => setIndex((i) => (i - 1 + total) % total),
    [total],
  );
  const next = useCallback(() => setIndex((i) => (i + 1) % total), [total]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    }
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [prev, next]);

  if (total === 0) return null;

  const activeTitle = slides[index]?.props.title;

  return (
    <section
      ref={containerRef as React.RefObject<HTMLElement>}
      className="taskito-carousel my-6 rounded-lg border border-fd-border bg-fd-card overflow-hidden focus:outline-none focus:ring-2 focus:ring-fd-primary/40"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: container hosts arrow-key navigation per WAI-ARIA carousel pattern
      tabIndex={0}
      aria-roledescription="carousel"
      aria-label={title ?? "Diagram carousel"}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-fd-border bg-fd-muted">
        <div className="flex items-baseline gap-2 min-w-0">
          {title && (
            <span className="text-sm font-semibold text-fd-foreground shrink-0">
              {title}
            </span>
          )}
          {activeTitle && (
            <span className="text-sm text-fd-muted-foreground truncate font-mono">
              {title ? "·" : ""} {activeTitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-fd-muted-foreground tabular-nums">
            {index + 1} / {total}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={prev}
              aria-label="Previous diagram"
              className="size-7 rounded-md border border-fd-border hover:bg-fd-accent hover:border-fd-primary/40 flex items-center justify-center transition-colors"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Next diagram"
              className="size-7 rounded-md border border-fd-border hover:bg-fd-accent hover:border-fd-primary/40 flex items-center justify-center transition-colors"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="relative">
        {slides.map((slide, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: stable list of slides
            key={i}
            style={{ display: i === index ? "block" : "none" }}
            className="px-4 pb-2"
            aria-hidden={i !== index}
          >
            {slide}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 py-3 border-t border-fd-border bg-fd-muted/40">
        {slides.map((slide, i) => {
          const slideTitle = slide.props.title;
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list of slides
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to ${slideTitle ?? `diagram ${i + 1}`}`}
              aria-current={i === index}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index
                  ? "w-7 bg-fd-primary"
                  : "w-1.5 bg-fd-muted-foreground/30 hover:bg-fd-muted-foreground/60",
              )}
            />
          );
        })}
      </div>
    </section>
  );
}
