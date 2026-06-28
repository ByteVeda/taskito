// Single source of truth for every SDK the docs site supports.
//
// Adding a language (java, go, …) is a one-entry change: append its id to
// `SDK_IDS` and add a `SDK_PROFILES` row. Everything else — the `Sdk` type, the
// nav trees, the sidebar switcher, the no-flash boot script, the SDK-aware
// diagrams and prose primitives — derives from this file. Nothing else should
// hardcode the literals `"python"`/`"node"`.

/** Every supported SDK id, in display order. Also the URL prefix (`/python/…`)
 *  and the `<html data-sdk>` value. Order drives the switcher + nav. */
export const SDK_IDS = ["python", "node"] as const;

export type Sdk = (typeof SDK_IDS)[number];

/** The SDK assumed before any user choice — used by the SSG server snapshot and
 *  the boot script, so prerendered HTML and first paint agree. */
export const DEFAULT_SDK: Sdk = "python";

export interface SdkProfile {
  /** Stable id; URL prefix and `data-sdk` value. */
  id: Sdk;
  /** Switcher / breadcrumb label, e.g. "Node.js". */
  label: string;
  /** Language name for prose ("a hybrid <language>/Rust system"). */
  language: string;
  /** The FFI boundary crossed into the shared Rust core, shown in the
   *  architecture stack ("<binding> boundary"), e.g. "PyO3", "N-API". */
  binding: string;
  /** Section directories under `content/docs`, in nav order. `architecture` and
   *  `resources` are SDK-neutral and appear in every SDK's nav. */
  navSections: string[];
}

export const SDK_PROFILES: Record<Sdk, SdkProfile> = {
  python: {
    id: "python",
    label: "Python",
    language: "Python",
    binding: "PyO3",
    navSections: [
      "python/getting-started",
      "python/guides",
      "architecture",
      "python/api-reference",
      "python/more/examples",
      "resources",
    ],
  },
  node: {
    id: "node",
    label: "Node.js",
    language: "Node.js",
    binding: "N-API",
    navSections: [
      "node/getting-started",
      "node/guides",
      "architecture",
      "node/api-reference",
      "node/more/examples",
      "resources",
    ],
  },
};

export function isSdk(value: string | null | undefined): value is Sdk {
  return SDK_IDS.includes(value as Sdk);
}

export function sdkProfile(sdk: Sdk): SdkProfile {
  return SDK_PROFILES[sdk];
}

/** Ordered `{ id, label }` pairs for switcher UIs. */
export function sdkLabels(): { id: Sdk; label: string }[] {
  return SDK_IDS.map((id) => ({ id, label: SDK_PROFILES[id].label }));
}
