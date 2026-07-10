import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
} from "react";

/** Count body rows and the widest row's cell count, so large tables can opt into
 *  the frozen header/first-column treatment. Walks past thead/tbody to the trs. */
function measure(children: ReactNode): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  const walk = (node: ReactNode) => {
    for (const child of Children.toArray(node)) {
      if (!isValidElement(child)) {
        continue;
      }
      const el = child as { type: unknown; props?: { children?: ReactNode } };
      if (el.type === "tr") {
        rows += 1;
        const cells = Children.toArray(el.props?.children).filter(
          isValidElement,
        );
        cols = Math.max(cols, cells.length);
      } else {
        walk(el.props?.children);
      }
    }
  };
  walk(children);
  return { rows, cols };
}

/**
 * Wraps every Markdown/MDX `<table>` in the prototype's `.md-table` shell so
 * tables across the docs get the rounded surface, header band, and row rules
 * from `docs.css`. Mapped onto the `table` element in `mdxComponents`, so it
 * applies everywhere without touching individual pages. Wide or long tables
 * additionally get `sticky` — a frozen header row and first column — so the
 * feature/tool axes stay visible while scrolling a large comparison matrix.
 */
export function MdxTable(props: ComponentProps<"table">) {
  const { rows, cols } = measure(props.children);
  const sticky = cols >= 5 || rows >= 12;
  return (
    <div className={sticky ? "md-table sticky" : "md-table"}>
      <table {...props} />
    </div>
  );
}
