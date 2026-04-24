import { createFileRoute } from "@tanstack/react-router";

// Lazy route: the virtual-list + log stream load only on demand. See
// `logs.lazy.tsx` for the actual component.
export const Route = createFileRoute("/logs")({});
