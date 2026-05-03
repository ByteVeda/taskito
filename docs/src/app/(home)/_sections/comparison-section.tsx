import { CodePanel, SectionHeader } from "@/components/ui";
import { highlight } from "@/lib/highlight";
import { COMPARISON } from "@/lib/landing-content";

export async function ComparisonSection() {
  const [taskitoCode, celeryCode] = await Promise.all([
    highlight(COMPARISON.taskito.code, "python"),
    highlight(COMPARISON.celery.code, "python"),
  ]);

  return (
    <section className="px-4 py-20 max-w-6xl mx-auto w-full">
      <SectionHeader
        title={COMPARISON.title}
        description={COMPARISON.description}
      />
      <div className="space-y-6">
        <div className="grid md:grid-cols-2 gap-4">
          <CodePanel
            tone="primary"
            label={COMPARISON.taskito.label}
            caption={COMPARISON.taskito.caption}
          >
            {taskitoCode}
          </CodePanel>
          <CodePanel
            tone="muted"
            label={COMPARISON.celery.label}
            caption={COMPARISON.celery.caption}
          >
            {celeryCode}
          </CodePanel>
        </div>
        <DifferentiatorTable />
      </div>
    </section>
  );
}

function DifferentiatorTable() {
  return (
    <div className="rounded-lg border border-fd-border bg-fd-card overflow-hidden">
      <table className="w-full border-collapse text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-fd-border bg-fd-muted">
            <th
              scope="col"
              className="text-left px-4 py-3 font-medium text-fd-muted-foreground"
            >
              <span className="sr-only">Property</span>
            </th>
            <th
              scope="col"
              className="text-left px-4 py-3 font-semibold text-fd-primary"
            >
              {COMPARISON.taskito.label}
            </th>
            <th
              scope="col"
              className="text-left px-4 py-3 font-semibold text-fd-foreground"
            >
              {COMPARISON.celery.label}
            </th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON.rows.map((row, i) => (
            <tr
              key={row.label}
              className={
                i < COMPARISON.rows.length - 1
                  ? "border-b border-fd-border"
                  : undefined
              }
            >
              <th
                scope="row"
                className="text-left px-4 py-3 font-medium text-fd-muted-foreground align-top"
              >
                {row.label}
              </th>
              <td className="px-4 py-3 align-top text-fd-foreground">
                {row.taskito}
              </td>
              <td className="px-4 py-3 align-top text-fd-muted-foreground">
                {row.celery}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
