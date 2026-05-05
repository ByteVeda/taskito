import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <DocsLayout tabMode="top" tree={source.getPageTree()} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}
