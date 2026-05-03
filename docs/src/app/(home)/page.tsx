import {
  ComparisonSection,
  CTA,
  Features,
  Hero,
  HowItWorks,
  Integrations,
  UseCases,
  WorkerPool,
} from "./_sections";

export default function HomePage() {
  return (
    <main className="flex flex-col flex-1">
      <Hero />
      <HowItWorks />
      <WorkerPool />
      <Features />
      <UseCases />
      <Integrations />
      <ComparisonSection />
      <CTA />
    </main>
  );
}
