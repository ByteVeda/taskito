import { Link } from "react-router";

const COLS = [
  {
    title: "Docs",
    links: [
      { label: "Getting Started", href: "/getting-started/installation" },
      { label: "Guides", href: "/guides" },
      { label: "Architecture", href: "/architecture" },
      { label: "API Reference", href: "/api-reference" },
    ],
  },
  {
    title: "More",
    links: [
      { label: "Examples", href: "/more/examples" },
      { label: "Celery comparison", href: "/more/comparison" },
      { label: "FAQ", href: "/more/faq" },
      { label: "Changelog", href: "/more/changelog" },
    ],
  },
  {
    title: "Project",
    links: [
      {
        label: "GitHub",
        href: "https://github.com/ByteVeda/taskito",
        external: true,
      },
      {
        label: "Releases",
        href: "https://github.com/ByteVeda/taskito/releases",
        external: true,
      },
      {
        label: "Issues",
        href: "https://github.com/ByteVeda/taskito/issues",
        external: true,
      },
      {
        label: "PyPI",
        href: "https://pypi.org/project/taskito/",
        external: true,
      },
    ],
  },
];

export function Footer() {
  return (
    <footer className="foot">
      <div className="foot-grid">
        <div className="foot-brand">
          <span className="brand">
            <span className="logo" aria-hidden="true" />
            <span className="brand-word">
              taski<span className="bto">to</span>
            </span>
          </span>
          <p>
            Rust-powered, brokerless task queue for Python and Node.js. No
            Redis, no RabbitMQ.
          </p>
        </div>
        {COLS.map((col) => (
          <div key={col.title} className="foot-col">
            <h4>{col.title}</h4>
            {col.links.map((l) =>
              "external" in l && l.external ? (
                <a key={l.label} href={l.href} target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              ) : (
                <Link key={l.label} to={l.href}>
                  {l.label}
                </Link>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="foot-bottom">
        <span>© 2026 ByteVeda · taskito</span>
        <span>MIT License · v0.16</span>
      </div>
    </footer>
  );
}
