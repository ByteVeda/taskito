import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";
import { CTA as CTA_CONTENT } from "@/lib/landing-content";

export function CTA() {
  return (
    <section className="px-4 py-20 mb-12">
      <div className="max-w-3xl mx-auto rounded-xl border border-fd-border bg-fd-card p-10 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          {renderTitleWithCode(CTA_CONTENT.title)}
        </h2>
        <p className="text-fd-muted-foreground mb-7 max-w-xl mx-auto">
          {CTA_CONTENT.description}
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Button
            variant="primary"
            href={CTA_CONTENT.primary.href}
            icon={<ArrowRight className="size-4" />}
          >
            {CTA_CONTENT.primary.label}
          </Button>
          <Button variant="secondary" href={CTA_CONTENT.secondary.href}>
            {CTA_CONTENT.secondary.label}
          </Button>
        </div>
      </div>
    </section>
  );
}

function renderTitleWithCode(title: string) {
  const parts = title.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable split
        <code key={i} className="font-mono text-fd-primary">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
