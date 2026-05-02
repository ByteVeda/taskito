import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-col flex-1">
      <section className="flex flex-col items-center justify-center text-center px-4 py-24 flex-1">
        <h1 className="text-5xl font-bold tracking-tight mb-4">Taskito</h1>
        <p className="text-xl text-fd-muted-foreground max-w-2xl mb-8">
          Rust-powered task queue for Python. Replace Celery without Redis.
          Start with SQLite, scale to Postgres. No broker required.
        </p>
        <div className="flex gap-3">
          <Link
            href="/docs/getting-started/quickstart"
            className="rounded-md bg-fd-primary px-5 py-2.5 text-fd-primary-foreground font-medium hover:opacity-90"
          >
            Quickstart
          </Link>
          <Link
            href="/docs/getting-started/installation"
            className="rounded-md border border-fd-border px-5 py-2.5 font-medium hover:bg-fd-accent"
          >
            Install
          </Link>
        </div>
      </section>
      <section className="grid sm:grid-cols-3 gap-6 px-4 py-16 max-w-6xl mx-auto w-full">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">Brokerless</h3>
          <p className="text-sm text-fd-muted-foreground">
            Start with SQLite, scale to Postgres. No Redis or RabbitMQ to
            install, configure, or operate.
          </p>
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">Rust-powered</h3>
          <p className="text-sm text-fd-muted-foreground">
            Scheduler, dispatcher, and storage are Rust. Async worker pool,
            native tokio runtime, thin PyO3 boundary.
          </p>
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">Python-native</h3>
          <p className="text-sm text-fd-muted-foreground">
            Decorate a function. Async tasks, periodic schedules, DAG workflows,
            resource injection — all from a clean Python API.
          </p>
        </div>
      </section>
    </main>
  );
}
