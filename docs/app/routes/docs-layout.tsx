import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { SearchModal, Sidebar, Toc } from "@/components/docs";
import { SiteNav } from "@/components/ui";

/** Shell for every docs page: top nav + sidebar + article outlet + on-this-page TOC. */
export default function DocsLayout() {
  const [searchOpen, setSearchOpen] = useState(false);

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
        <Sidebar />
        <Outlet />
        <Toc />
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
