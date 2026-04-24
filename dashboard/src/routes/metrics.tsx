import { createFileRoute } from "@tanstack/react-router";

// Component lives in the `.lazy.tsx` counterpart so Recharts only loads when
// the user actually opens the metrics screen. Keeping this file
// component-less makes TanStack's lazy-route convention kick in.
export const Route = createFileRoute("/metrics")({});
