const TASKITO_CODE = `from taskito import Queue

queue = Queue(db_path="tasks.db")

@queue.task(max_retries=3, rate_limit="100/m")
def send_email(to, subject, body):
    smtp.send(to, subject, body)

# Enqueue
send_email.delay("alice@example.com", "Hi", "Body")

# Run the worker
# $ taskito worker --app tasks:queue`;

const CELERY_CODE = `from celery import Celery

app = Celery(
    "myapp",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
)
app.conf.task_default_rate_limit = "100/m"

@app.task(bind=True, max_retries=3)
def send_email(self, to, subject, body):
    try:
        smtp.send(to, subject, body)
    except SMTPError as exc:
        raise self.retry(exc=exc, countdown=60)

# Enqueue
send_email.delay("alice@example.com", "Hi", "Body")

# Run the worker (in a separate terminal, plus Redis)
# $ celery -A myapp worker --loglevel=info`;

type Tone = "primary" | "muted";

const ROWS: { label: string; taskito: string; celery: string }[] = [
  {
    label: "Install",
    taskito: "pip install taskito",
    celery: "pip install celery[redis] + run Redis daemon",
  },
  {
    label: "Background services",
    taskito: "1 (worker)",
    celery: "3 (worker, beat, Redis)",
  },
  {
    label: "Default storage",
    taskito: "SQLite file (built-in)",
    celery: "Redis (separate daemon)",
  },
  {
    label: "Retry config in the example above",
    taskito: "max_retries=3 decorator arg",
    celery: "try/except + self.retry(exc=…)",
  },
];

export function Comparison() {
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
        <CodePanel
          label="taskito"
          caption="Brokerless · single process"
          tone="primary"
          code={TASKITO_CODE}
        />
        <CodePanel
          label="Celery + Redis"
          caption="Requires Redis · 3 processes"
          tone="muted"
          code={CELERY_CODE}
        />
      </div>
      <DifferentiatorTable />
    </div>
  );
}

function CodePanel({
  label,
  caption,
  tone,
  code,
}: {
  label: string;
  caption: string;
  tone: Tone;
  code: string;
}) {
  const accent =
    tone === "primary" ? "border-t-fd-primary" : "border-t-fd-border";
  return (
    <div
      className={`rounded-lg border border-fd-border border-t-2 bg-fd-card overflow-hidden ${accent}`}
    >
      <div className="flex items-baseline justify-between px-4 py-3 border-b border-fd-border bg-fd-muted">
        <span
          className={`text-sm font-semibold ${
            tone === "primary" ? "text-fd-primary" : "text-fd-foreground"
          }`}
        >
          {label}
        </span>
        <span className="text-xs text-fd-muted-foreground">{caption}</span>
      </div>
      <pre className="p-5 text-sm font-mono leading-relaxed overflow-x-auto bg-fd-card">
        <code>{code}</code>
      </pre>
    </div>
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
              taskito
            </th>
            <th
              scope="col"
              className="text-left px-4 py-3 font-semibold text-fd-foreground"
            >
              Celery + Redis
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, i) => (
            <tr
              key={row.label}
              className={
                i < ROWS.length - 1 ? "border-b border-fd-border" : undefined
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
