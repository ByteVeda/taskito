// Landing-page copy + code, ported verbatim from the prototype (index.html / landing.js).

/** A worker-output line: glyph + text, optionally a result value + timing. */
export interface OutLine {
  glyph: string;
  glyphKind: "p" | "g";
  text: string;
  value?: string;
  timing?: string;
}

export interface LangPane {
  id: "py";
  label: string;
  filename: string;
  install: string;
  code: string;
  output: OutLine[];
  docHref: string;
  docLabel: string;
}

export const HERO_PANES: LangPane[] = [
  {
    id: "py",
    label: "Python",
    filename: "tasks.py",
    install: "pip install taskito",
    code: `from taskito import Queue

queue = Queue(db_path="tasks.db")

@queue.task(max_retries=3)
def add(a: int, b: int) -> int:
    return a + b

job = add.delay(2, 3)
print(job.result())   # → 5`,
    output: [
      { glyph: "$", glyphKind: "p", text: "taskito worker --app tasks:queue" },
      {
        glyph: "→",
        glyphKind: "p",
        text: "scheduler online · 6 workers ready",
      },
      {
        glyph: "✓",
        glyphKind: "g",
        text: "add(2, 3) =",
        value: "5",
        timing: "12 ms",
      },
    ],
    docHref: "/python/getting-started/quickstart",
    docLabel: "Read the Python quickstart",
  },
];

/** Roadmap languages: disabled tab + "coming soon" panel (no fabricated SDK). */
export interface SoonLang {
  id: "go" | "java";
  label: string;
  heading: string;
  body: string;
}

export const SOON_PANES: SoonLang[] = [
  {
    id: "go",
    label: "Go",
    heading: "Go client — coming soon",
    body: "A native Go client for enqueuing and inspecting taskito jobs is on the roadmap.",
  },
  {
    id: "java",
    label: "Java",
    heading: "Java client — coming soon",
    body: "A JVM client for enqueuing taskito jobs from Java & Kotlin is planned.",
  },
];

export interface IconCard {
  icon: string;
  rect?: boolean;
  title: string;
  body: string;
}

export const FEATURES: IconCard[] = [
  {
    icon: "M13 2L3 14h7l-1 8 10-12h-7l1-8z",
    title: "Brokerless",
    body: "No Redis, no RabbitMQ. Everything in a single SQLite file — queue, results, rate limits, schedules. Just <code>pip install</code> or <code>pnpm add</code> and go.",
  },
  {
    icon: "M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3",
    rect: true,
    title: "Rust-powered",
    body: "The scheduler, dispatcher, and storage engine are all Rust. Tokio runtime, OS-thread worker pool; thin PyO3 and napi-rs boundaries keep Python and Node overhead negligible.",
  },
  {
    icon: "M22 12h-4l-3 9L9 3l-3 9H2",
    title: "One core, two SDKs",
    body: "First-class <b>Python</b> and <b>Node.js</b> clients are peers over the same Rust core and store — enqueue in one runtime, run workers in the other. Zero cross-language dependency.",
  },
  {
    icon: "M6 3v12M18 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM15 6a9 9 0 0 0-9 9",
    title: "DAG workflows",
    body: "Multi-step pipelines as directed acyclic graphs. Fan-out, fan-in, conditions, approval gates, sub-workflows, incremental re-runs, Mermaid viz.",
  },
  {
    icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    title: "Resource system",
    body: "Inject database connections, HTTP clients, and cloud SDKs by name. Three-layer pipeline: argument interception, worker DI, transparent proxy.",
  },
  {
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    title: "Production-ready",
    body: "Retries with exponential backoff, dead letter queue, rate limits, circuit breakers, distributed locks, structured logs, OTel/Sentry/Prometheus.",
  },
];

export const USE_CASES: IconCard[] = [
  {
    icon: "M12 2C6.48 2 2 4.02 2 6.5v11C2 19.98 6.48 22 12 22s10-2.02 10-4.5v-11C22 4.02 17.52 2 12 2zM2 6.5C2 8.43 6.48 10 12 10s10-1.57 10-3.5M2 12c0 1.93 4.48 3.5 10 3.5s10-1.57 10-3.5",
    title: "ETL pipelines",
    body: "Chain extract → transform → load as a DAG. Fan out across workers, fan in to aggregate, restart from any node on failure.",
  },
  {
    icon: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6",
    title: "Email & notifications",
    body: "Bursty SMTP, push, or webhook delivery. Per-task rate limits keep providers happy; retries with backoff handle transient failures.",
  },
  {
    icon: "M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3",
    rect: true,
    title: "ML inference & batch",
    body: "Long-running model jobs with progress tracking, soft timeouts, and prefork pools for true CPU parallelism without GIL contention.",
  },
  {
    icon: "M12 6v6l4 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z",
    title: "Scheduled jobs",
    body: "Six-field cron syntax down to the second. Periodic tasks live in the scheduler — no separate beat daemon to babysit.",
  },
];

export interface DeltaRow {
  label: string;
  taskito: string;
  celery: string;
}

export const DELTA: DeltaRow[] = [
  {
    label: "Install",
    taskito: "pip install taskito",
    celery: "pip install celery[redis] + run Redis daemon",
  },
  {
    label: "Background services",
    taskito: "<b>1</b> (worker)",
    celery: "3 (worker, beat, Redis)",
  },
  {
    label: "Default storage",
    taskito: "SQLite file <b>(built-in)</b>",
    celery: "Redis (separate daemon)",
  },
  {
    label: "Retry config above",
    taskito: "max_retries=3 <b>decorator arg</b>",
    celery: "try/except + self.retry(exc=…)",
  },
];

export interface IntegrationGroup {
  group: string;
  items: string[];
}

export const INTEGRATIONS: IntegrationGroup[] = [
  { group: "Python frameworks", items: ["Django", "FastAPI", "Flask"] },
  { group: "Node frameworks", items: ["Express", "Fastify", "NestJS"] },
  { group: "Storage", items: ["Postgres", "SQLite", "Redis"] },
  { group: "Observability", items: ["OpenTelemetry", "Sentry", "Prometheus"] },
];

export const CODE_TASKITO = `from taskito import Queue

queue = Queue(db_path="tasks.db")

@queue.task(max_retries=3, rate_limit="100/m")
def send_email(to, subject, body):
    smtp.send(to, subject, body)

# Enqueue + run
send_email.delay("a@x.com", "Hi", "Body")
# $ taskito worker --app tasks:queue`;

export const CODE_CELERY = `from celery import Celery

app = Celery("myapp",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1")
app.conf.task_default_rate_limit = "100/m"

@app.task(bind=True, max_retries=3)
def send_email(self, to, subject, body):
    try:
        smtp.send(to, subject, body)
    except SMTPError as exc:
        raise self.retry(exc=exc, countdown=60)

# $ celery -A myapp worker  (+ Redis)`;
