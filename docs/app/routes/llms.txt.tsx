import { llmsIndex } from "@/lib/llms";

// Resource route: prerendered to a plain-text file at build (ssr:false runs the
// loader once during prerender).
export function loader() {
  return new Response(llmsIndex(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
