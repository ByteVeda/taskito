import type { ComponentProps } from "react";

/**
 * Wraps every Markdown/MDX `<table>` in the prototype's `.md-table` shell so
 * tables across the docs get the rounded surface, header band, and row rules
 * from `docs.css`. Mapped onto the `table` element in `mdxComponents`, so it
 * applies everywhere without touching individual pages.
 */
export function MdxTable(props: ComponentProps<"table">) {
  return (
    <div className="md-table">
      <table {...props} />
    </div>
  );
}
