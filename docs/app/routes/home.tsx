import {
  Comparison,
  CTA,
  Features,
  Footer,
  Hero,
  HowItWorks,
  Integrations,
  UseCases,
  useReveal,
} from "@/components/landing";
import { SiteNav } from "@/components/ui";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Taskito — one queue, Python and Node" },
    {
      name: "description",
      content:
        "Rust-powered task queue for Python and Node.js. No broker required.",
    },
  ];
}

export default function Home() {
  useReveal();
  return (
    <>
      <div className="bgfx" aria-hidden="true">
        <div className="grid" />
        <div className="glow" />
        <div className="glow two" />
      </div>
      <SiteNav />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <UseCases />
        <Comparison />
        <Integrations />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
