import { MDXProvider } from "@mdx-js/react";
import { Fragment, lazy, Suspense, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { PrevNext } from "@/components/docs";
import { mdxComponents } from "@/components/mdx";
import { getDocLoader } from "@/lib/content";
import { docMeta } from "@/lib/manifest";
import { redirectFor } from "@/lib/redirects";
import type { Route } from "./+types/docs.$";

function pathOf(params: { "*"?: string }): string {
  return `/${params["*"] ?? ""}`;
}

/** Breadcrumb from the URL segments; the leading segment links to its section index. */
function Breadcrumb({ path }: { path: string }) {
  const segs = path.split("/").filter(Boolean);
  if (segs.length < 2) {
    return null;
  }
  const crumbs = segs.slice(0, -1).map((seg, i) => {
    const href = `/${segs.slice(0, i + 1).join("/")}`;
    const label =
      docMeta(href)?.title ??
      seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { href, label };
  });
  return (
    <div className="crumb">
      {crumbs.map((c) => (
        <Fragment key={c.href}>
          <Link to={c.href}>{c.label}</Link>
          <span className="sep">/</span>
        </Fragment>
      ))}
    </div>
  );
}

export function meta({ params }: Route.MetaArgs) {
  const path = pathOf(params);
  const dest = redirectFor(path);
  if (dest) {
    // Prerendered into the old URL's static HTML so a direct hit refreshes to
    // the new home; canonical points search engines at the destination.
    return [
      { title: "Redirecting… | Taskito" },
      { httpEquiv: "refresh", content: `0; url=${dest}` },
      { tagName: "link", rel: "canonical", href: dest },
    ];
  }
  const meta = docMeta(path);
  return [
    { title: meta?.title ? `${meta.title} | Taskito` : "Taskito" },
    { name: "description", content: meta?.description ?? "" },
  ];
}

/** Stub shown at a moved URL: meta-refresh handles direct hits, this handles
 *  client-side (SPA) navigation by replacing the history entry. */
function RedirectStub({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to, navigate]);
  return (
    <article className="article">
      <h1>Redirecting…</h1>
      <p className="lead">
        This page moved to <Link to={to}>{to}</Link>.
      </p>
    </article>
  );
}

export default function DocRoute({ params }: Route.ComponentProps) {
  const path = pathOf(params);
  const dest = redirectFor(path);
  const loader = getDocLoader(path);
  const meta = docMeta(path);

  // Each page is its own lazily-loaded chunk; React.lazy is resolved during
  // prerender (Suspense) so the static HTML still carries the full content.
  const Page = useMemo(() => (loader ? lazy(loader) : null), [loader]);

  if (dest) {
    return <RedirectStub to={dest} />;
  }

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
      <Breadcrumb path={path} />
      {meta?.title ? <h1>{meta.title}</h1> : null}
      {meta?.description ? <p className="lead">{meta.description}</p> : null}
      <MDXProvider components={mdxComponents}>
        {/* Key by path: client-side navigation between two pages that share this
            splat route re-suspends the lazy page. Without a fresh boundary per
            path, React retains the previous committed tree for the whole route.

            React.lazy has no SSR hydration: on the client the chunk re-loads, so
            the prerendered body briefly drops to the fallback and re-expands.
            Reserve vertical space so that swap doesn't shove the prev/next footer
            up and down (layout shift). */}
        <Suspense
          key={path}
          fallback={<div className="doc-loading" aria-hidden="true" />}
        >
          <Page />
        </Suspense>
      </MDXProvider>
      <PrevNext />
    </article>
  );
}
