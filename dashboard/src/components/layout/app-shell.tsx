import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui";
import { CommandPalette } from "./command-palette";
import { Header } from "./header";
import { RouteErrorBoundary } from "./route-error-boundary";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="flex-1 px-4 py-5 md:px-6 md:py-6">
            <div className="mx-auto max-w-[1400px] animate-fade-in">
              <RouteErrorBoundary>{children}</RouteErrorBoundary>
            </div>
          </main>
        </div>
        <CommandPalette />
      </div>
    </TooltipProvider>
  );
}
