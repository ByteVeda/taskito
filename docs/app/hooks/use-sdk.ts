import { useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { forcedSdkForPath, type Sdk, sdkStore } from "@/lib";

export type { Sdk };

/** Reactive active SDK + setter, backed by the SSG-safe external store. The
 *  server snapshot is the default SDK, so prerendered HTML and the first client
 *  render agree; the boot script has already applied the real value to
 *  `<html data-sdk>` before paint. */
export function useSdk(): { sdk: Sdk; setSdk: (sdk: Sdk) => void } {
  const sdk = useSyncExternalStore(
    sdkStore.subscribe,
    sdkStore.getSnapshot,
    sdkStore.getServerSnapshot,
  );
  return { sdk, setSdk: sdkStore.set };
}

/** The SDK to render for the current page: forced by the URL prefix on
 *  SDK-specific pages, otherwise the global store value (shared pages). Avoids a
 *  first-paint nav flash when a `/node/*` URL loads while the store still holds
 *  the default. */
export function useActiveSdk(): Sdk {
  const { sdk } = useSdk();
  const { pathname } = useLocation();
  return forcedSdkForPath(pathname.replace(/\/$/, "") || "/") ?? sdk;
}
