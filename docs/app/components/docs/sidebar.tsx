import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useActiveSdk, useSdk } from "@/hooks";
import {
  forcedSdkForPath,
  type NavNode,
  navForSdk,
  type Sdk,
  sdkSwitchTarget,
} from "@/lib";

function containsHref(node: NavNode, current: string): boolean {
  return (
    node.href === current ||
    (node.children?.some((c) => containsHref(c, current)) ?? false)
  );
}

const SDK_LABELS: { id: Sdk; label: string }[] = [
  { id: "python", label: "Python" },
  { id: "node", label: "Node.js" },
];

/** Global SDK toggle. Sets the shared store (flips inline variants + this nav);
 *  on an SDK-specific page it also navigates to the counterpart page, on a shared
 *  page it stays put. A labelled control — it switches the whole page, not a panel. */
function SdkSwitch({ sdk, current }: { sdk: Sdk; current: string }) {
  const { setSdk } = useSdk();
  const navigate = useNavigate();

  function select(target: Sdk) {
    if (target === sdk) {
      return;
    }
    setSdk(target);
    if (forcedSdkForPath(current)) {
      navigate(sdkSwitchTarget(current, target));
    }
  }

  return (
    <div className="sdk-switch">
      {SDK_LABELS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`sdk-opt ${sdk === id ? "active" : ""}`.trim()}
          aria-pressed={sdk === id}
          aria-label={`${label} SDK`}
          onClick={() => select(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Caret({
  open,
  onToggle,
  title,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      className="nav-caret"
      data-open={open || undefined}
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
      onClick={onToggle}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

function NavLink({ node, current }: { node: NavNode; current: string }) {
  if (!node.href) {
    return <span className="nav-item nav-item-label">{node.title}</span>;
  }
  return (
    <Link
      to={node.href}
      className={`nav-item ${node.href === current ? "active" : ""}`.trim()}
    >
      {node.title}
    </Link>
  );
}

/** A subsection with children — collapsible at any depth, auto-opens around the
 *  active page. The label itself toggles (same behaviour as a top-level group),
 *  so a subsection-of-a-subsection expands/collapses on click just like its parent. */
function NavSection({ node, current }: { node: NavNode; current: string }) {
  const active = node.children?.some((c) => containsHref(c, current)) ?? false;
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) {
      setOpen(true);
    }
  }, [active]);
  const toggle = () => setOpen((o) => !o);
  return (
    <div className="nav-subsection">
      <div className="nav-sub-head">
        <button
          type="button"
          className={`nav-item nav-sub-toggle ${
            node.href === current ? "active" : ""
          }`.trim()}
          aria-expanded={open}
          onClick={toggle}
        >
          {node.title}
        </button>
        <Caret open={open} onToggle={toggle} title={node.title} />
      </div>
      {open ? <NavTree nodes={node.children ?? []} current={current} /> : null}
    </div>
  );
}

function NavTree({ nodes, current }: { nodes: NavNode[]; current: string }) {
  return (
    <div className="nav-sub">
      {nodes.map((node) =>
        node.children?.length ? (
          <NavSection key={node.title} node={node} current={current} />
        ) : (
          <NavLink
            key={node.href ?? node.title}
            node={node}
            current={current}
          />
        ),
      )}
    </div>
  );
}

/** Top-level group — collapsible, default-open for the section holding the page. */
function NavGroup({ group, current }: { group: NavNode; current: string }) {
  const active = containsHref(group, current);
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) {
      setOpen(true);
    }
  }, [active]);
  const hasChildren = Boolean(group.children?.length);
  return (
    <div className="nav-group">
      <div className="gt">
        {hasChildren ? (
          <button
            type="button"
            className="gt-toggle"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {group.title}
          </button>
        ) : group.href ? (
          <Link to={group.href} className="gt-link">
            {group.title}
          </Link>
        ) : (
          <span>{group.title}</span>
        )}
        {hasChildren ? (
          <Caret
            open={open}
            onToggle={() => setOpen((o) => !o)}
            title={group.title}
          />
        ) : null}
      </div>
      {hasChildren && open ? (
        <NavTree nodes={group.children ?? []} current={current} />
      ) : null}
    </div>
  );
}

export function Sidebar({
  onSearch,
  open = false,
  onClose,
}: {
  onSearch?: () => void;
  /** Drawer open state — only affects the mobile (≤860px) overlay layout. */
  open?: boolean;
  onClose?: () => void;
}) {
  const { pathname } = useLocation();
  const current = pathname.replace(/\/$/, "") || "/";
  const sdk = useActiveSdk();
  return (
    <>
      {/* Backdrop sits under the drawer on mobile; tapping it closes the menu. */}
      <button
        type="button"
        className={`sidebar-backdrop ${open ? "open" : ""}`.trim()}
        aria-label="Close navigation menu"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside className={`sidebar ${open ? "open" : ""}`.trim()}>
        <button type="button" className="side-search" onClick={onSearch}>
          Search docs
          <span className="sk">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
        </button>
        <SdkSwitch sdk={sdk} current={current} />
        <nav id="sidenav">
          {navForSdk(sdk).map((group) => (
            <NavGroup key={group.title} group={group} current={current} />
          ))}
        </nav>
      </aside>
    </>
  );
}
