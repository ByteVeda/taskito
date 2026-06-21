import type { ReactNode } from "react";

// Layered architecture stack — ports the prototype's `.archstack` HTML (clean
// semantic layers + PyO3/store boundaries), replacing the old sketch SVG.

interface Layer {
  tag: string;
  tagKind?: "py" | "rust" | "store";
  title: string;
  body: ReactNode;
  role?: string;
  accent?: boolean;
}

function ArchStack({
  layers,
  bounds,
  legend,
}: {
  layers: Layer[];
  bounds: ReactNode[]; // one fewer than layers
  legend?: ReactNode;
}) {
  return (
    <div className="archstack">
      {legend ? <div className="arch-legend">{legend}</div> : null}
      {layers.map((l, i) => (
        <div key={l.title}>
          <div className={`layer ${l.tagKind ?? ""}`.trim()}>
            <span className={`ltag t-${l.tagKind ?? "store"}`}>{l.tag}</span>
            <div className="lbody">
              <div className="lt">{l.title}</div>
              <div className="ld">{l.body}</div>
            </div>
            {l.role ? <span className="lrole">{l.role}</span> : null}
          </div>
          {i < bounds.length ? <div className="bound">{bounds[i]}</div> : null}
        </div>
      ))}
    </div>
  );
}

/** `architecture/overview.mdx` — the Python / Rust / Store stack. */
export function ArchitectureStack() {
  return (
    <ArchStack
      legend={
        <>
          <span className="al-item">
            <span className="al-arrow down">↓</span> you call down — enqueue
            jobs
          </span>
          <span className="al-item">
            <span className="al-arrow up">↑</span> results &amp; state flow back
            up
          </span>
        </>
      }
      layers={[
        {
          tag: "Python",
          tagKind: "py",
          title: "User-facing API",
          body: (
            <>
              <code>Queue</code>, <code>@task</code>, <code>.delay()</code>,
              results, workflows, resources — the surface you write against.
            </>
          ),
          role: "what you write",
        },
        {
          tag: "Rust",
          tagKind: "rust",
          title: "Engine",
          body: "Scheduler, dispatcher, worker pool, rate limiter — Tokio runtime, OS-thread pool, near-zero Python overhead.",
          role: "where the work runs",
        },
        {
          tag: "Store",
          tagKind: "store",
          title: "Storage layer",
          body: "SQLite (bundled) or Postgres — jobs, results, schedules, rate-limit state, all in one place.",
          role: "where state lives",
        },
      ]}
      bounds={[
        <>
          <span className="bdir">↓</span>
          <span className="pyo3">PyO3 boundary</span>
          <span className="bdir">↑</span>
        </>,
        <>
          <span className="bdir">↓</span>reads &amp; writes
          <span className="bdir">↑</span>
        </>,
      ]}
    />
  );
}

/** `architecture/resources.mdx` — the 3-layer resource pipeline. */
export function ResourcePipeline() {
  return (
    <ArchStack
      layers={[
        {
          tag: "Layer 1",
          tagKind: "py",
          title: "Argument interception",
          body: (
            <>
              The <code>ArgumentInterceptor</code> walks every argument before
              serialization. CONVERT types become JSON-safe markers, REDIRECT
              types become DI placeholders, PROXY types are deconstructed,
              REJECT types raise in strict mode.
            </>
          ),
        },
        {
          tag: "Layer 2",
          tagKind: "py",
          title: "Worker resource runtime",
          body: (
            <>
              <code>ResourceRuntime</code> initializes resources at worker
              startup in topological order, then injects requested ones (via{" "}
              <code>inject=</code> or <code>Inject["name"]</code>) as kwargs.
              Task-scoped resources come from a semaphore pool.
            </>
          ),
        },
        {
          tag: "Layer 3",
          tagKind: "rust",
          title: "Transparent proxy",
          body: (
            <>
              Non-serializable handles (files, clients, sessions) are
              deconstructed on enqueue and reconstructed on the worker via
              registered <code>ProxyHandler</code>s — HMAC-signed,
              schema-validated, LIFO-cleaned.
            </>
          ),
          accent: true,
        },
      ]}
      bounds={["enqueue → worker", "before task()"]}
    />
  );
}
