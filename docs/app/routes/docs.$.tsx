import { MDXProvider } from "@mdx-js/react";
import { lazy, Suspense, useMemo } from "react";
import { PrevNext } from "@/components/docs";
import { mdxComponents } from "@/components/mdx";
import { getDocLoader } from "@/lib/content";
import { docMeta } from "@/lib/manifest";
import type { Route } from "./+types/docs.$";

function pathOf(params: { "*"?: string }): string {
  return `/${params["*"] ?? ""}`;
}

export function meta({ params }: Route.MetaArgs) {
  const meta = docMeta(pathOf(params));
  return [
    { title: meta?.title ? `${meta.title} | Taskito` : "Taskito" },
    { name: "description", content: meta?.description ?? "" },
  ];
}

export default function DocRoute({ params }: Route.ComponentProps) {
  const path = pathOf(params);
  const loader = getDocLoader(path);
  const meta = docMeta(path);

  // Each page is its own lazily-loaded chunk; React.lazy is resolved during
  // prerender (Suspense) so the static HTML still carries the full content.
  const Page = useMemo(() => (loader ? lazy(loader) : null), [loader]);

  if (!Page) {
    return (
      <article className="article">
        <h1>Page not found</h1>
        <p className="lead">No documentation page matches this URL.</p>
      </article>
    );
  }

  return (
    <article className="article">
      {meta?.title ? <h1>{meta.title}</h1> : null}
      {meta?.description ? <p className="lead">{meta.description}</p> : null}
      <MDXProvider components={mdxComponents}>
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      </MDXProvider>
      <PrevNext />
    </article>
  );
}
