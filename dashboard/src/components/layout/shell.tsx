import type { ComponentChildren } from "preact";
import { Header } from "./header";
import { Sidebar } from "./sidebar";

interface ShellProps {
  children: ComponentChildren;
}

export function Shell({ children }: ShellProps) {
  return (
    <div class="min-h-screen">
      <Header />
      <div class="flex">
        <Sidebar />
        <main class="flex-1 p-8 overflow-auto h-[calc(100vh-56px)]">
          <div class="max-w-[1280px] mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
