import { SectionHeader } from "@/components/ui";
import {
  FEATURES,
  FEATURES_DESCRIPTION,
  FEATURES_TITLE,
  type LandingFeature,
} from "@/lib/landing-content";

export function Features() {
  return (
    <section className="px-4 py-20 max-w-6xl mx-auto w-full">
      <SectionHeader
        title={FEATURES_TITLE}
        description={FEATURES_DESCRIPTION}
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map((feature) => (
          <FeatureCard key={feature.title} feature={feature} />
        ))}
      </div>
    </section>
  );
}

function FeatureCard({ feature }: { feature: LandingFeature }) {
  const { icon: Icon, title, body } = feature;
  return (
    <div className="rounded-lg border border-fd-border bg-fd-card p-6 hover:border-fd-primary/40 transition-colors">
      <div className="size-10 rounded-md bg-fd-primary/10 flex items-center justify-center mb-4">
        <Icon className="size-5 text-fd-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-fd-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
