import {
  Activity,
  BookOpen,
  Clock,
  Code2,
  Cpu,
  Database,
  Layers,
  type LucideIcon,
  Mail,
  Shield,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";

export type CtaTarget = {
  href: string;
  label: string;
};

export type LandingHero = {
  badge: string;
  headline: string[];
  description: string;
  primaryCta: CtaTarget;
  secondaryCta: CtaTarget;
  ghostCta: CtaTarget;
  preview: {
    filename: string;
    code: string;
  };
};

export type LandingFeature = {
  icon: LucideIcon;
  title: string;
  body: string;
};

export type DocSectionCard = {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
};

export const DOC_SECTIONS: DocSectionCard[] = [
  {
    icon: BookOpen,
    title: "Guides",
    description:
      "Recipes for tasks, queues, workers, retries, workflows, observability, and integrations.",
    href: "/guides",
  },
  {
    icon: Layers,
    title: "Architecture",
    description:
      "How the Rust core, scheduler, worker pool, storage, and resource graph fit together.",
    href: "/architecture/overview",
  },
  {
    icon: Code2,
    title: "API Reference",
    description:
      "Queues, tasks, results, contexts, the canvas, workflows, testing helpers, and the CLI.",
    href: "/api-reference/overview",
  },
  {
    icon: Sparkles,
    title: "More",
    description:
      "Worked examples, the Celery comparison, FAQ, and the per-release changelog.",
    href: "/more/examples",
  },
];

export type ComparisonRow = {
  label: string;
  taskito: string;
  celery: string;
};

export type ComparisonStack = {
  label: string;
  caption: string;
  code: string;
};

export type LandingComparison = {
  title: string;
  description: string;
  taskito: ComparisonStack;
  celery: ComparisonStack;
  rows: ComparisonRow[];
};

export type LandingCta = {
  title: string;
  description: string;
  primary: CtaTarget;
  secondary: CtaTarget;
};

export const HERO: LandingHero = {
  badge: "v0.15 — faster dispatch, leaner storage, msgpack payloads",
  headline: ["Task queue", "without the broker."],
  description:
    "Rust-powered task queue for Python. Replace Celery without Redis or RabbitMQ. Start with SQLite, scale to Postgres.",
  primaryCta: {
    href: "/getting-started/quickstart",
    label: "Quickstart",
  },
  secondaryCta: {
    href: "/getting-started/installation",
    label: "Install",
  },
  ghostCta: {
    href: "https://github.com/ByteVeda/taskito",
    label: "GitHub →",
  },
  preview: {
    filename: "tasks.py",
    code: `# pip install taskito
from taskito import Queue

queue = Queue(db_path="tasks.db")

@queue.task()
def add(a, b):
    return a + b

job = add.delay(2, 3)
print(job.result())  # 5`,
  },
};

export const FEATURES_TITLE = "What you get";
export const FEATURES_DESCRIPTION =
  "The convenience of Celery, the performance of Rust, the simplicity of SQLite.";

export const FEATURES: LandingFeature[] = [
  {
    icon: Zap,
    title: "Brokerless",
    body: "No Redis, no RabbitMQ. Everything in a single SQLite file — queue, results, rate limits, schedules. Just `pip install` and go.",
  },
  {
    icon: Cpu,
    title: "Rust-powered",
    body: "The scheduler, dispatcher, and storage engine are all Rust. Tokio runtime, OS-thread worker pool, thin PyO3 boundary keeps the Python overhead negligible.",
  },
  {
    icon: Activity,
    title: "Async-first",
    body: "`async def` tasks dispatch onto a dedicated event loop — no `asyncio.run()` wrapping, no thread-pool bridging. Sync and async tasks coexist transparently.",
  },
  {
    icon: Workflow,
    title: "DAG workflows",
    body: "Multi-step pipelines as directed acyclic graphs. Fan-out, fan-in, conditions, approval gates, sub-workflows, incremental re-runs, Mermaid visualization.",
  },
  {
    icon: Layers,
    title: "Resource system",
    body: "Inject database connections, HTTP clients, and cloud SDKs by name. Three-layer pipeline: argument interception, worker DI, transparent proxy reconstruction.",
  },
  {
    icon: Shield,
    title: "Production-ready",
    body: "Retries with exponential backoff, dead letter queue, rate limits, circuit breakers, distributed locks, structured logs, OTel/Sentry/Prometheus middleware.",
  },
];

export const COMPARISON: LandingComparison = {
  title: "Less to operate",
  description:
    "The same task, two stacks. Side by side, with the operational delta.",
  taskito: {
    label: "taskito",
    caption: "Brokerless · single process",
    code: `from taskito import Queue

queue = Queue(db_path="tasks.db")

@queue.task(max_retries=3, rate_limit="100/m")
def send_email(to, subject, body):
    smtp.send(to, subject, body)

# Enqueue
send_email.delay("alice@example.com", "Hi", "Body")

# Run the worker
# $ taskito worker --app tasks:queue`,
  },
  celery: {
    label: "Celery + Redis",
    caption: "Requires Redis · 3 processes",
    code: `from celery import Celery

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
# $ celery -A myapp worker --loglevel=info`,
  },
  rows: [
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
  ],
};

export type UseCase = {
  icon: LucideIcon;
  title: string;
  body: string;
  href: string;
};

export const USE_CASES_TITLE = "Built for the jobs you actually have";
export const USE_CASES_DESCRIPTION =
  "Pick the workload — taskito ships the primitives.";

export const USE_CASES: UseCase[] = [
  {
    icon: Database,
    title: "ETL pipelines",
    body: "Chain extract → transform → load as a DAG. Fan out across workers, fan in to aggregate, restart from any node on failure.",
    href: "/guides/workflows",
  },
  {
    icon: Mail,
    title: "Email & notifications",
    body: "Bursty SMTP, push, or webhook delivery. Per-task rate limits keep providers happy; retries with backoff handle transient failures.",
    href: "/guides/reliability/retries",
  },
  {
    icon: Cpu,
    title: "ML inference & batch",
    body: "Long-running model jobs with progress tracking, soft timeouts, and prefork pools for true CPU parallelism without GIL contention.",
    href: "/guides/advanced-execution/prefork",
  },
  {
    icon: Clock,
    title: "Scheduled jobs",
    body: "Six-field cron syntax down to the second. Periodic tasks live in the scheduler — no separate beat daemon to babysit.",
    href: "/guides/core/scheduling",
  },
];

export const INTEGRATIONS_TITLE = "Slots into your stack";
export const INTEGRATIONS_DESCRIPTION =
  "First-class support for the tools you already run.";

export type IntegrationGroup = {
  group: string;
  items: string[];
};

export const INTEGRATIONS: IntegrationGroup[] = [
  {
    group: "Frameworks",
    items: ["Django", "FastAPI", "Flask"],
  },
  {
    group: "Storage",
    items: ["Postgres", "SQLite", "Redis"],
  },
  {
    group: "Observability",
    items: ["OpenTelemetry", "Sentry", "Prometheus"],
  },
  {
    group: "Serialization",
    items: ["JSON", "MsgPack", "Cloudpickle"],
  },
];

export const CTA: LandingCta = {
  title: "Five minutes from `pip install` to your first job.",
  description:
    "The quickstart walks you through defining a task, enqueuing it, and watching the worker run it — no Redis, no broker, no config.",
  primary: {
    href: "/getting-started/quickstart",
    label: "Start the quickstart",
  },
  secondary: {
    href: "/more/comparison",
    label: "See the full comparison",
  },
};
