import { SectionHeader } from "@/components/ui";
import {
  INTEGRATIONS,
  INTEGRATIONS_DESCRIPTION,
  INTEGRATIONS_TITLE,
} from "@/lib/landing-content";

export function Integrations() {
  return (
    <section className="px-4 py-16 max-w-5xl mx-auto w-full">
      <SectionHeader
        title={INTEGRATIONS_TITLE}
        description={INTEGRATIONS_DESCRIPTION}
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {INTEGRATIONS.map((group) => (
          <div
            key={group.group}
            className="rounded-lg border border-fd-border bg-fd-card/50 p-5"
          >
            <div className="text-xs uppercase tracking-[0.18em] text-fd-muted-foreground font-semibold mb-3">
              {group.group}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center rounded-md border border-fd-border/60 bg-fd-card px-2 py-1 text-xs font-medium text-fd-foreground/80 hover:border-fd-primary/40 hover:text-fd-primary transition-colors"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
