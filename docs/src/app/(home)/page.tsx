import {
  ComparisonSection,
  CTA,
  Features,
  Hero,
  HowItWorks,
} from "./_sections";

export default function HomePage() {
  return (
    <main className="flex flex-col flex-1">
      <Hero />
      <HowItWorks />
      <Features />
      <ComparisonSection />
      <CTA />
    </main>
  );
}
