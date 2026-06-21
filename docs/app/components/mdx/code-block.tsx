import { Check, Copy } from "lucide-react";
import { type ComponentProps, useRef, useState } from "react";

/** Wraps a shiki-highlighted `<pre>` in the design's `.codeblock` panel with a
 *  header bar (language label + copy button). Mapped as the MDX `pre` element. */
export function CodeBlock(
  props: ComponentProps<"pre"> & { "data-language"?: string },
) {
  const { children, ...preProps } = props;
  const lang = props["data-language"] || "code";
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const text = ref.current?.textContent ?? "";
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="codeblock">
      <div className="cb-bar">
        <span className="lang">{lang}</span>
        <button
          type="button"
          className="cb-copy"
          onClick={copy}
          aria-label="Copy code"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <pre ref={ref} {...preProps}>
        {children}
      </pre>
    </div>
  );
}
