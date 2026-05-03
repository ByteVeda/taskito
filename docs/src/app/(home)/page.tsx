import {
  Activity,
  ArrowRight,
  Cpu,
  Layers,
  Shield,
  Workflow,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { Comparison } from "./comparison";

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

function Hero() {
  return (
    <section className="relative px-4 pt-20 pb-24 sm:pt-28 sm:pb-32 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,var(--color-fd-primary)/10%,transparent_60%)]"
      />
      <div className="max-w-5xl mx-auto grid lg:grid-cols-[1.2fr,1fr] gap-12 items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-3 py-1 text-xs font-medium text-fd-muted-foreground mb-6">
            <span className="size-1.5 rounded-full bg-fd-primary" />
            v0.12 — Rust core, native async, DAG workflows
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-5 leading-[1.05]">
            Task queue
            <br />
            without the broker.
          </h1>
          <p className="text-lg sm:text-xl text-fd-muted-foreground max-w-xl mb-8 leading-relaxed">
            Rust-powered task queue for Python. Replace Celery without Redis or
            RabbitMQ. Start with SQLite, scale to Postgres.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/docs/getting-started/quickstart"
              className="inline-flex items-center gap-2 rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground hover:opacity-90 transition-opacity"
            >
              Quickstart
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/docs/getting-started/installation"
              className="inline-flex items-center gap-2 rounded-md border border-fd-border bg-fd-card px-5 py-2.5 text-sm font-medium hover:bg-fd-accent transition-colors"
            >
              Install
            </Link>
            <Link
              href="https://github.com/ByteVeda/taskito"
              className="inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium text-fd-muted-foreground hover:text-fd-foreground transition-colors"
            >
              GitHub →
            </Link>
          </div>
        </div>
        <CodePreview />
      </div>
    </section>
  );
}

function CodePreview() {
  return (
    <div className="rounded-lg border border-fd-border bg-fd-card overflow-hidden shadow-xl shadow-fd-primary/5">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-fd-border bg-fd-muted">
        <div className="flex gap-1.5">
          <div className="size-2.5 rounded-full bg-red-500/70" />
          <div className="size-2.5 rounded-full bg-yellow-500/70" />
          <div className="size-2.5 rounded-full bg-green-500/70" />
        </div>
        <span className="text-xs text-fd-muted-foreground ml-2 font-mono">
          tasks.py
        </span>
      </div>
      <pre className="p-5 text-sm font-mono leading-relaxed overflow-x-auto">
        <code>
          <span className="text-fd-muted-foreground">
            # pip install taskito
          </span>
          {"\n"}
          <span className="text-purple-500 dark:text-purple-400">from</span>{" "}
          taskito{" "}
          <span className="text-purple-500 dark:text-purple-400">import</span>{" "}
          Queue{"\n\n"}
          queue ={" "}
          <span className="text-blue-500 dark:text-blue-400">Queue</span>
          (db_path=
          <span className="text-emerald-600 dark:text-emerald-400">
            "tasks.db"
          </span>
          ){"\n\n"}
          <span className="text-fd-muted-foreground">@queue.task()</span>
          {"\n"}
          <span className="text-purple-500 dark:text-purple-400">def</span>{" "}
          <span className="text-blue-500 dark:text-blue-400">add</span>(a, b):
          {"\n"}
          {"    "}
          <span className="text-purple-500 dark:text-purple-400">return</span> a
          + b{"\n\n"}
          job = add.
          <span className="text-blue-500 dark:text-blue-400">delay</span>(
          <span className="text-amber-600 dark:text-amber-400">2</span>,{" "}
          <span className="text-amber-600 dark:text-amber-400">3</span>){"\n"}
          <span className="text-fd-muted-foreground">print</span>(job.
          <span className="text-blue-500 dark:text-blue-400">result</span>())
          {"  "}
          <span className="text-fd-muted-foreground"># 5</span>
        </code>
      </pre>
    </div>
  );
}

const FEATURES = [
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

function Features() {
  return (
    <section className="px-4 py-20 max-w-6xl mx-auto w-full">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
          What you get
        </h2>
        <p className="text-fd-muted-foreground text-lg">
          The convenience of Celery, the performance of Rust, the simplicity of
          SQLite.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-lg border border-fd-border bg-fd-card p-6 hover:border-fd-primary/40 transition-colors"
          >
            <div className="size-10 rounded-md bg-fd-primary/10 flex items-center justify-center mb-4">
              <Icon className="size-5 text-fd-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">{title}</h3>
            <p className="text-sm text-fd-muted-foreground leading-relaxed">
              {body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ComparisonSection() {
  return (
    <section className="px-4 py-20 max-w-6xl mx-auto w-full">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
          Less to operate
        </h2>
        <p className="text-fd-muted-foreground text-lg">
          The same task, two stacks. Side by side, with the operational delta.
        </p>
      </div>
      <Comparison />
    </section>
  );
}

function CTA() {
  return (
    <section className="px-4 py-20 mb-12">
      <div className="max-w-3xl mx-auto rounded-xl border border-fd-border bg-fd-card p-10 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          Five minutes from{" "}
          <code className="font-mono text-fd-primary">pip install</code> to your
          first job.
        </h2>
        <p className="text-fd-muted-foreground mb-7 max-w-xl mx-auto">
          The quickstart walks you through defining a task, enqueuing it, and
          watching the worker run it — no Redis, no broker, no config.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/docs/getting-started/quickstart"
            className="inline-flex items-center gap-2 rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground hover:opacity-90 transition-opacity"
          >
            Start the quickstart
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/docs/more/comparison"
            className="inline-flex items-center gap-2 rounded-md border border-fd-border px-5 py-2.5 text-sm font-medium hover:bg-fd-accent transition-colors"
          >
            See the full comparison
          </Link>
        </div>
      </div>
    </section>
  );
}
