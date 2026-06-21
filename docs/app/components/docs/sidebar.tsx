import { Link, useLocation } from "react-router";
import { type NavNode, navForSdk, type Sdk, sdkForPath } from "@/lib/nav";

function SdkSwitch({ sdk }: { sdk: Sdk }) {
  return (
    <div className="sdk-switch" role="tablist">
      <Link
        to="/getting-started/installation"
        className={`sdk-opt ${sdk === "python" ? "active" : ""}`.trim()}
        role="tab"
        aria-selected={sdk === "python"}
      >
        Python
      </Link>
      <Link
        to="/node"
        className={`sdk-opt ${sdk === "node" ? "active" : ""}`.trim()}
        role="tab"
        aria-selected={sdk === "node"}
      >
        Node.js
      </Link>
    </div>
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

function NavTree({ nodes, current }: { nodes: NavNode[]; current: string }) {
  return (
    <div className="nav-sub">
      {nodes.map((node) =>
        node.children?.length ? (
          <div key={node.title} className="nav-subsection">
            <NavLink node={node} current={current} />
            <NavTree nodes={node.children} current={current} />
          </div>
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

export function Sidebar({ onSearch }: { onSearch?: () => void }) {
  const { pathname } = useLocation();
  const current = pathname.replace(/\/$/, "") || "/";
  const sdk = sdkForPath(current);
  return (
    <aside className="sidebar">
      <button type="button" className="side-search" onClick={onSearch}>
        Search docs
        <span className="sk">
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </span>
      </button>
      <SdkSwitch sdk={sdk} />
      <nav id="sidenav">
        {navForSdk(sdk).map((group) => (
          <div key={group.title} className="nav-group">
            {group.href ? (
              <Link to={group.href} className="gt gt-link">
                {group.title}
              </Link>
            ) : (
              <div className="gt">{group.title}</div>
            )}
            {group.children?.length ? (
              <NavTree nodes={group.children} current={current} />
            ) : null}
          </div>
        ))}
      </nav>
    </aside>
  );
}
