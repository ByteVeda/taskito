import { MDXProvider } from "@mdx-js/react";
import { PrevNext } from "@/components/docs";
import { mdxComponents } from "@/components/mdx";
import { getDocPage } from "@/lib/content";
import type { Route } from "./+types/docs.$";

function pathOf(params: { "*"?: string }): string {
  return `/${params["*"] ?? ""}`;
}

export function meta({ params }: Route.MetaArgs) {
  const page = getDocPage(pathOf(params));
  const title = page?.frontmatter.title;
  return [
    { title: title ? `${title} | Taskito` : "Taskito" },
    { name: "description", content: page?.frontmatter.description ?? "" },
  ];
}

export default function DocRoute({ params }: Route.ComponentProps) {
  const page = getDocPage(pathOf(params));
  if (!page) {
    return (
      <article className="article">
        <h1>Page not found</h1>
        <p className="lead">No documentation page matches this URL.</p>
      </article>
    );
  }
  const { Component, frontmatter } = page;
  return (
    <article className="article">
      {frontmatter.title ? <h1>{frontmatter.title}</h1> : null}
      {frontmatter.description ? (
        <p className="lead">{frontmatter.description}</p>
      ) : null}
      <MDXProvider components={mdxComponents}>
        <Component />
      </MDXProvider>
      <PrevNext />
    </article>
  );
}
