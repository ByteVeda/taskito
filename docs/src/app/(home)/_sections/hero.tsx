import { ArrowRight } from "lucide-react";
import { Fragment } from "react";
import { Button, CodePanel } from "@/components/ui";
import { highlight } from "@/lib/highlight";
import { HERO } from "@/lib/landing-content";
import { WindowDots } from "./_window-dots";

export async function Hero() {
  const highlightedPreview = await highlight(HERO.preview.code, "python");

  return (
    <section className="relative px-4 pt-20 pb-24 sm:pt-28 sm:pb-32 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,var(--color-fd-primary)/10%,transparent_60%)]"
      />
      <div className="max-w-5xl mx-auto grid lg:grid-cols-[1.2fr,1fr] gap-12 items-center">
        <div>
          <Badge>{HERO.badge}</Badge>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-5 leading-[1.05]">
            {HERO.headline.map((line, i) => (
              <Fragment key={line}>
                {line}
                {i < HERO.headline.length - 1 ? <br /> : null}
              </Fragment>
            ))}
          </h1>
          <p className="text-lg sm:text-xl text-fd-muted-foreground max-w-xl mb-8 leading-relaxed">
            {HERO.description}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              href={HERO.primaryCta.href}
              icon={<ArrowRight className="size-4" />}
            >
              {HERO.primaryCta.label}
            </Button>
            <Button variant="secondary" href={HERO.secondaryCta.href}>
              {HERO.secondaryCta.label}
            </Button>
            <Button variant="ghost" href={HERO.ghostCta.href}>
              {HERO.ghostCta.label}
            </Button>
          </div>
        </div>
        <CodePanel
          header={<WindowDots filename={HERO.preview.filename} />}
          className="shadow-xl shadow-fd-primary/5"
        >
          {highlightedPreview}
        </CodePanel>
      </div>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-3 py-1 text-xs font-medium text-fd-muted-foreground mb-6">
      <span className="size-1.5 rounded-full bg-fd-primary" />
      {children}
    </div>
  );
}
