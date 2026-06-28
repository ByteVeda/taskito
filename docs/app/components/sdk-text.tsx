import type { ReactNode } from "react";
import { SDK_IDS, SDK_PROFILES, type Sdk, type SdkProfile } from "@/lib";

// Inline SDK-aware text atoms for shared pages + arch diagrams. No-flash: every
// SDK's text ships and CSS hides the inactive ones (off `<html data-sdk>`, like
// `<SdkOnly>`) — no re-render, no hydration flash, all variants indexable.

/** Render one span per SDK, picking a value from each profile; CSS shows only
 *  the active SDK's span. */
function SdkVariants({ pick }: { pick: (profile: SdkProfile) => ReactNode }) {
  return (
    <>
      {SDK_IDS.map((id) => (
        <span key={id} data-sdk-variant={id}>
          {pick(SDK_PROFILES[id])}
        </span>
      ))}
    </>
  );
}

/** Active SDK's display name, e.g. "Python" / "Node.js". */
export function SdkName() {
  return <SdkVariants pick={(p) => p.label} />;
}

/** Active SDK's language name for prose, e.g. "Python" / "Node.js". */
export function SdkLang() {
  return <SdkVariants pick={(p) => p.language} />;
}

/** Active SDK's FFI boundary into the Rust core, e.g. "PyO3" / "N-API". */
export function SdkBinding() {
  return <SdkVariants pick={(p) => p.binding} />;
}

/** Inline value that differs per SDK, e.g.
 *  `<SdkSwap python={<code>@task</code>} node={<code>.task()</code>} />`.
 *  Missing SDK falls back to `fallback` → default SDK → first provided. */
export function SdkSwap({
  fallback,
  ...bySdk
}: Partial<Record<Sdk, ReactNode>> & { fallback?: ReactNode }) {
  const provided = SDK_IDS.map((id) => bySdk[id]).find((v) => v !== undefined);
  const resolve = (id: Sdk): ReactNode =>
    bySdk[id] ?? fallback ?? provided ?? null;
  return <SdkVariants pick={(p) => resolve(p.id)} />;
}
