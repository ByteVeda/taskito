import { llmsFull } from "@/lib/llms";

export function loader() {
  return new Response(llmsFull(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
