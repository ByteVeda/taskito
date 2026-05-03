import { ComparisonSection, CTA, Features, Hero } from "./_sections";

export default function HomePage() {
  return (
    <main className="flex flex-col flex-1">
      <Hero />
      <Features />
      <ComparisonSection />
      <CTA />
    </main>
  );
}
