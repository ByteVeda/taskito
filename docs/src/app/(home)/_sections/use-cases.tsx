import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { SectionHeader } from "@/components/ui";
import {
  USE_CASES,
  USE_CASES_DESCRIPTION,
  USE_CASES_TITLE,
  type UseCase,
} from "@/lib/landing-content";

export function UseCases() {
  return (
    <section className="px-4 py-20 max-w-6xl mx-auto w-full">
      <SectionHeader
        title={USE_CASES_TITLE}
        description={USE_CASES_DESCRIPTION}
      />
      <div className="grid sm:grid-cols-2 gap-5">
        {USE_CASES.map((useCase) => (
          <UseCaseCard key={useCase.title} useCase={useCase} />
        ))}
      </div>
    </section>
  );
}

function UseCaseCard({ useCase }: { useCase: UseCase }) {
  const { icon: Icon, title, body, href } = useCase;
  return (
    <Link
      href={href}
      className="group relative rounded-lg border border-fd-border bg-fd-card p-6 hover:border-fd-primary/40 hover:bg-fd-accent/40 transition-all overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute -top-12 -right-12 size-32 rounded-full bg-fd-primary/5 group-hover:bg-fd-primary/10 transition-colors"
      />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div className="size-10 rounded-md bg-fd-primary/10 flex items-center justify-center">
            <Icon className="size-5 text-fd-primary" />
          </div>
          <ArrowUpRight className="size-4 text-fd-muted-foreground/50 group-hover:text-fd-primary group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all" />
        </div>
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-fd-muted-foreground leading-relaxed">
          {body}
        </p>
      </div>
    </Link>
  );
}
