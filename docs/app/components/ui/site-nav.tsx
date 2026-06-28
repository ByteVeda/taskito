import { Menu, Search } from "lucide-react";
import { Link } from "react-router";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useActiveSdk } from "@/hooks";

// lucide dropped brand glyphs, so the GitHub mark is inlined.
function GithubMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 .1.8 1.7 2.5 1.4.1-.7.4-1.2.7-1.5-2.5-.3-5.2-1.3-5.2-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 5 18.3 5.3 18.3 5.3c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.2 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6a11.5 11.5 0 0 0 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
    </svg>
  );
}

// `sdk` links are SDK-relative (prefixed with the active /python|/node); the rest
// are shared, SDK-neutral pages.
const LINKS: { label: string; href: string; sdk?: boolean }[] = [
  { label: "Getting Started", href: "getting-started/installation", sdk: true },
  { label: "Guides", href: "guides", sdk: true },
  { label: "Architecture", href: "/architecture" },
  { label: "API", href: "api-reference", sdk: true },
  { label: "Changelog", href: "/resources/changelog" },
];

/** Sticky top navigation, shared by the landing and docs shells. `onMenu` is
 *  passed only by the docs shell — it renders the mobile button that opens the
 *  sidebar drawer (the landing has no sidebar, so it omits it). */
export function SiteNav({
  onSearch,
  onMenu,
}: {
  onSearch?: () => void;
  onMenu?: () => void;
}) {
  const sdk = useActiveSdk();
  return (
    <nav className="nav">
      {onMenu ? (
        <button
          type="button"
          className="menu-btn"
          onClick={onMenu}
          aria-label="Open navigation menu"
        >
          <Menu size={18} />
        </button>
      ) : null}
      <Link to="/" className="brand">
        <span className="logo" aria-hidden="true" />
        <span>
          task<span className="bto">ito</span>
        </span>
      </Link>
      <div className="navlinks">
        {LINKS.map((l) => (
          <Link key={l.href} to={l.sdk ? `/${sdk}/${l.href}` : l.href}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="navright">
        <button type="button" className="kbar" onClick={onSearch}>
          <Search size={14} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <ThemeToggle />
        <a
          className="icon-btn"
          href="https://github.com/ByteVeda/taskito"
          aria-label="GitHub repository"
          target="_blank"
          rel="noreferrer"
        >
          <GithubMark />
        </a>
      </div>
    </nav>
  );
}
