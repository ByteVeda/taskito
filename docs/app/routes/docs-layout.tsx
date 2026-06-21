import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { SearchModal, Sidebar, Toc } from "@/components/docs";
import { SiteNav } from "@/components/ui";
import { useActiveSdk, useSdk } from "@/hooks";
import { forcedSdkForPath } from "@/lib";

/** Shell for every docs page: top nav + sidebar + article outlet + on-this-page TOC. */
export default function DocsLayout() {
  const [searchOpen, setSearchOpen] = useState(false);
  const { pathname } = useLocation();
  const { setSdk } = useSdk();
  const sdk = useActiveSdk();

  // Visiting an SDK-specific page (`/python/*`,`/node/*`) makes that SDK sticky,
  // so walking onto a shared page keeps the choice. No-op on shared pages.
  useEffect(() => {
    const forced = forcedSdkForPath(pathname.replace(/\/$/, "") || "/");
    if (forced) {
      setSdk(forced);
    }
  }, [pathname, setSdk]);

  // ⌘K / Ctrl-K opens search anywhere in the docs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <SiteNav onSearch={() => setSearchOpen(true)} />
      <div className="docs-shell">
        <Sidebar onSearch={() => setSearchOpen(true)} />
        <Outlet />
        <Toc />
      </div>
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        sdk={sdk}
      />
    </>
  );
}
