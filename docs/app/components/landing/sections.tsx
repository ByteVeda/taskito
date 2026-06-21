import { useState } from "react";
import { Link } from "react-router";
import { RawHtml } from "@/components/ui";
import { highlightPython } from "@/lib/highlight-lite";
import {
  CODE_CELERY,
  CODE_TASKITO,
  DELTA,
  FEATURES,
  type IconCard,
  INTEGRATIONS,
  USE_CASES,
} from "@/lib/landing-content";

function Icon({ d, rect }: { d: string; rect?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {rect ? <rect x="4" y="4" width="16" height="16" rx="3" /> : null}
      <path d={d} />
    </svg>
  );
}

function SectionHead({
  kicker,
  title,
  lead,
}: {
  kicker: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="section-head reveal">
      <div className="kicker">{kicker}</div>
      <h2>{title}</h2>
      {lead ? <p>{lead}</p> : null}
    </div>
  );
}

const STATIONS = [
  { label: "YOUR CODE", title: "enqueue", hint: ".delay()" },
  { label: "QUEUE", title: "store", hint: "SQLite · PG" },
  { label: "SCHEDULER", title: "dispatch", hint: "Rust · Tokio", accent: true },
  {
    label: "WORKERS",
    title: "execute",
    hint: "6 · pool",
    accent: true,
    pool: true,
  },
];

export function HowItWorks() {
  return (
    <section className="section how">
      <div className="wrap">
        <SectionHead
          kicker="How it works"
          title="Enqueue here, execute there."
          lead="Your Python or Node code enqueues a job. The Rust scheduler hands it to a worker. The result lands back in the shared store — no broker in the middle."
        />
        <div className="diagram reveal">
          <div className="flowdiag">
            {STATIONS.map((s, i) => (
              <Station
                key={s.label}
                station={s}
                last={i === STATIONS.length - 1}
                index={i}
              />
            ))}
          </div>
          <div className="returnlane">
            <span className="rspark" />
            <span className="rlabel">result written back to the store</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Station({
  station,
  last,
  index,
}: {
  station: (typeof STATIONS)[number];
  last: boolean;
  index: number;
}) {
  return (
    <>
      <div className={`station ${station.accent ? "accent" : ""}`.trim()}>
        <div className="srow">
          {station.pool ? (
            <div className="dpool">
              {Array.from({ length: 6 }).map((_, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative dot row
                <span key={k} style={{ "--k": k } as React.CSSProperties} />
              ))}
            </div>
          ) : (
            <div className="dicon" />
          )}
          <div className="smeta">
            <span className="slabel">{station.label}</span>
            <span className="stitle">{station.title}</span>
            <span className="shint">{station.hint}</span>
          </div>
        </div>
      </div>
      {last ? null : (
        <div
          className="wire"
          style={{ "--wd": `${index * 0.5}s` } as React.CSSProperties}
        >
          <span className="spark" />
        </div>
      )}
    </>
  );
}

export function Features() {
  return (
    <section className="section">
      <div className="wrap">
        <SectionHead
          kicker="What you get"
          title="The convenience of Celery, the performance of Rust"
          lead="Everything you need to run background jobs in production — and nothing you don't."
        />
        <div className="feat-grid">
          {FEATURES.map((c: IconCard) => (
            <div key={c.title} className="card reveal">
              <div className="sheen" />
              <div className="ic">
                <Icon d={c.icon} rect={c.rect} />
              </div>
              <h3>{c.title}</h3>
              <RawHtml as="p" html={c.body} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function UseCases() {
  return (
    <section
      className="section"
      style={{
        background: "var(--bg-soft)",
        borderBlock: "1px solid var(--line)",
      }}
    >
      <div className="wrap">
        <SectionHead
          kicker="Use cases"
          title="Built for the jobs you actually have"
          lead="Pick the workload — taskito ships the primitives."
        />
        <div className="uc-grid">
          {USE_CASES.map((c) => (
            <div key={c.title} className="uc reveal">
              <div className="ic">
                <Icon d={c.icon} rect={c.rect} />
              </div>
              <div>
                <h3>
                  {c.title} <span className="arr">→</span>
                </h3>
                <RawHtml as="p" html={c.body} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Comparison() {
  return (
    <section className="section">
      <div className="wrap">
        <SectionHead
          kicker="taskito vs Celery"
          title="Less to operate"
          lead="The same task, two stacks. Side by side, with the operational delta."
        />
        <div className="cmp-cols reveal">
          <div className="cmp-card win">
            <div className="cmp-head">
              <span className="nm">
                taskito <span className="badge-win">brokerless</span>
              </span>
              <span className="cap">single process</span>
            </div>
            <RawHtml
              className="cmp-code"
              html={highlightPython(CODE_TASKITO)}
            />
          </div>
          <div className="cmp-card">
            <div className="cmp-head">
              <span className="nm">Celery + Redis</span>
              <span className="cap">3 processes</span>
            </div>
            <RawHtml className="cmp-code" html={highlightPython(CODE_CELERY)} />
          </div>
        </div>
        <div className="delta reveal">
          <table>
            <thead>
              <tr>
                <th>&nbsp;</th>
                <th>taskito</th>
                <th>Celery + Redis</th>
              </tr>
            </thead>
            <tbody>
              {DELTA.map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <RawHtml as="td" className="tk" html={d.taskito} />
                  <RawHtml as="td" className="ce" html={d.celery} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function Integrations() {
  return (
    <section
      className="section"
      style={{
        background: "var(--bg-soft)",
        borderBlock: "1px solid var(--line)",
      }}
    >
      <div className="wrap">
        <SectionHead
          kicker="Integrations"
          title="Slots into your stack"
          lead="First-class support for the tools you already run."
        />
        <div className="int-grid reveal">
          {INTEGRATIONS.map((g) => (
            <div key={g.group} className="int-col">
              <h4>{g.group}</h4>
              <div className="chips">
                {g.items.map((it) => (
                  <div key={it} className="chip">
                    <span className="d" />
                    {it}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InstallPill({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="install-pill">
      <span className="pf">$</span>
      {cmd}
      <button
        type="button"
        className="copyInstall"
        aria-label="Copy"
        onClick={() => {
          navigator.clipboard?.writeText(cmd);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}

export function CTA() {
  return (
    <section className="section">
      <div className="cta-wrap reveal">
        <div className="kicker" style={{ display: "block", marginBottom: 14 }}>
          Get started
        </div>
        <h2>Five minutes from install to your first job.</h2>
        <p>
          The quickstart walks you through defining a task, enqueuing it, and
          watching the worker run it — in Python or Node, no Redis, no broker,
          no config.
        </p>
        <div className="install-row">
          <InstallPill cmd="pip install taskito" />
          <InstallPill cmd="pnpm add taskito" />
        </div>
        <div className="btns">
          <Link className="btn pri" to="/getting-started/quickstart">
            Start the quickstart →
          </Link>
          <Link className="btn sec" to="/more/comparison">
            See the full comparison
          </Link>
        </div>
      </div>
    </section>
  );
}
