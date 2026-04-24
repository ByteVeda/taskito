import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { CommandPaletteProvider } from "./command-palette-provider";
import { QueryProvider } from "./query-provider";
import { RefreshIntervalProvider } from "./refresh-interval-provider";
import { ThemeProvider } from "./theme-provider";

export function Providers({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <ThemeProvider>
      <QueryProvider client={queryClient}>
        <RefreshIntervalProvider>
          <CommandPaletteProvider>
            {children}
            <Toaster />
          </CommandPaletteProvider>
        </RefreshIntervalProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}

export { useCommandPalette } from "./command-palette-provider";
export type { RefreshOption } from "./refresh-interval-provider";
export { useRefreshInterval } from "./refresh-interval-provider";
export type { ResolvedTheme, Theme } from "./theme-provider";
export { useTheme } from "./theme-provider";
