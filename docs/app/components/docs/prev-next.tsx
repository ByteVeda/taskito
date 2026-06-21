import { Link, useLocation } from "react-router";
import { flatNav, sdkForPath } from "@/lib/nav";

/** Previous/next page links derived from the flattened SDK nav order. */
export function PrevNext() {
  const { pathname } = useLocation();
  const current = pathname.replace(/\/$/, "") || "/";
  const pages = flatNav(sdkForPath(current));
  const i = pages.findIndex((p) => p.href === current);
  if (i === -1) {
    return null;
  }
  const prev = pages[i - 1];
  const next = pages[i + 1];
  return (
    <nav className="pagenav">
      {prev ? (
        <Link to={prev.href}>
          <span className="dir">← Previous</span>
          <span className="ttl">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link to={next.href} className="nx">
          <span className="dir">Next →</span>
          <span className="ttl">{next.title}</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
