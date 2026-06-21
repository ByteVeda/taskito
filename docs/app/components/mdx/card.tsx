import type { ReactNode } from "react";
import { Link } from "react-router";

/** Design-matched replacement for `fumadocs-ui/components/card` (aliased in vite). */
export function Cards({ children }: { children: ReactNode }) {
  return <div className="next-grid card-grid">{children}</div>;
}

export function Card({
  title,
  href,
  icon,
  description,
  children,
}: {
  title: string;
  href?: string;
  icon?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  const body = (
    <>
      {icon ? <span className="card-ic">{icon}</span> : null}
      <span className="ttl">{title}</span>
      {(description ?? children) ? (
        <span className="card-desc">{description ?? children}</span>
      ) : null}
    </>
  );
  if (!href) {
    return <div className="next-card">{body}</div>;
  }
  if (/^(https?:|mailto:)/.test(href)) {
    return (
      <a className="next-card" href={href}>
        {body}
      </a>
    );
  }
  return (
    <Link className="next-card" to={href}>
      {body}
    </Link>
  );
}
