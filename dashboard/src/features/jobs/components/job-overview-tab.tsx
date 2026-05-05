import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { buttonVariants, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { applyJobContext, useIntegrations } from "@/features/settings";
import type { Job } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { formatAbsolute, formatDuration, formatRelative } from "@/lib/time";

interface JobOverviewTabProps {
  job: Job;
}

export function JobOverviewTab({ job }: JobOverviewTabProps) {
  const startedToCompleted =
    job.started_at && job.completed_at ? job.completed_at - job.started_at : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <JobIntegrations job={job} />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent>
          <Dl>
            <Row label="Task">{job.task_name}</Row>
            <Row label="Queue">{job.queue}</Row>
            <Row label="Priority">{job.priority}</Row>
            {job.unique_key ? <Row label="Unique key">{job.unique_key}</Row> : null}
          </Dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Execution</CardTitle>
        </CardHeader>
        <CardContent>
          <Dl>
            <Row label="Retries">
              {job.retry_count}
              {job.max_retries > 0 ? ` / ${job.max_retries}` : null}
            </Row>
            {job.progress != null ? (
              <Row label="Progress">{(job.progress * 100).toFixed(0)}%</Row>
            ) : null}
            <Row label="Timeout">{formatDuration(job.timeout_ms)}</Row>
            {startedToCompleted != null ? (
              <Row label="Duration">{formatDuration(startedToCompleted)}</Row>
            ) : null}
          </Dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Dl>
            <Row label="Created">
              <Timestamp ms={job.created_at} />
            </Row>
            <Row label="Scheduled">
              <Timestamp ms={job.scheduled_at} />
            </Row>
            {job.started_at ? (
              <Row label="Started">
                <Timestamp ms={job.started_at} />
              </Row>
            ) : null}
            {job.completed_at ? (
              <Row label="Completed">
                <Timestamp ms={job.completed_at} />
              </Row>
            ) : null}
          </Dl>
        </CardContent>
      </Card>

      {job.metadata ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-60 overflow-auto rounded-md bg-[var(--surface-2)] p-3 font-mono text-[11px] text-[var(--fg)]">
              {tryPrettyJson(job.metadata)}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      {job.error ? (
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle>Last error</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-danger-dim/40 p-3 font-mono text-[11px] text-danger">
              {job.error}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Dl({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">{children}</dl>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wider text-[var(--fg-subtle)]">{label}</dt>
      <dd className="text-[var(--fg)]">{children}</dd>
    </>
  );
}

function Timestamp({ ms }: { ms: number }) {
  return (
    <span className="inline-flex flex-col">
      <span className="tabular-nums">{formatAbsolute(ms)}</span>
      <span className="text-xs text-[var(--fg-subtle)]">{formatRelative(ms)}</span>
    </span>
  );
}

function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Render configured integration shortcuts (Grafana / Sentry / OTel) for
 * the given job. Each URL may contain a ``{job_id}`` placeholder; if it
 * doesn't, the configured URL opens as-is. Renders nothing when no
 * integration is configured.
 */
function JobIntegrations({ job }: { job: Job }) {
  const integrations = useIntegrations();
  const links = (
    [
      { label: "Open in Grafana", href: integrations.grafana },
      { label: "Open in Sentry", href: integrations.sentry },
      { label: "Open in OTel", href: integrations.otel },
    ] as const
  ).filter((entry) => entry.href);

  if (links.length === 0) return null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle>Integrations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {links.map(({ label, href }) => (
          <a
            key={label}
            href={applyJobContext(href, job.id)}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <ExternalLinkIcon className="size-4" aria-hidden />
            {label}
          </a>
        ))}
      </CardContent>
    </Card>
  );
}
