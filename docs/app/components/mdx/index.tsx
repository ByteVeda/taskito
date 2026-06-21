import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { Link } from "react-router";
import * as Animated from "@/components/animated";
import { DiagramCarousel, DiagramSlide } from "@/components/diagram-carousel";
import { Mermaid } from "@/components/mermaid";
import { Callout } from "./callout";
import { Card, Cards } from "./card";
import { Tab, Tabs } from "./tabs";

// Internal links use the router for client navigation; external/anchor links
// stay plain. Code blocks are highlighted at build time by rehype-shiki, and
// headings/paragraphs are styled by element selectors inside `.article`.
function Anchor({ href, children, ...rest }: ComponentProps<"a">) {
  if (href?.startsWith("/")) {
    return (
      <Link to={href} {...rest}>
        {children}
      </Link>
    );
  }
  const external = href?.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}

/** Components made available to every MDX page via `<MDXProvider>`. */
export const mdxComponents: MDXComponents = {
  a: Anchor,
  Callout,
  Tabs,
  Tab,
  Card,
  Cards,
  Mermaid,
  DiagramCarousel,
  DiagramSlide,
  ...Animated,
};
