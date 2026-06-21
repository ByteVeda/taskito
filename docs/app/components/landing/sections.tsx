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
        <div className="section-head">
          <span className="kicker">How it works</span>
          <h2>Enqueue here, execute there.</h2>
          <p>
            The Rust scheduler polls the store, dispatches to a worker pool, and
            writes results back — the same loop whether you enqueue from Python
            or Node.
          </p>
        </div>
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
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size decorative dot row
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

function IconGrid({
  items,
  className,
}: {
  items: IconCard[];
  className: string;
}) {
  return (
    <div className={className}>
      {items.map((c) => (
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
  );
}

export function Features() {
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <span className="kicker">Features</span>
          <h2>Everything a queue needs, nothing it doesn't.</h2>
        </div>
        <IconGrid items={FEATURES} className="feat-grid" />
      </div>
    </section>
  );
}

export function UseCases() {
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <span className="kicker">Use cases</span>
          <h2>Built for real workloads.</h2>
        </div>
        <IconGrid items={USE_CASES} className="uc-grid" />
      </div>
    </section>
  );
}

export function Comparison() {
  const [tab, setTab] = useState<"taskito" | "celery">("taskito");
  const code = tab === "taskito" ? CODE_TASKITO : CODE_CELERY;
  return (
    <section className="section cmp">
      <div className="wrap">
        <div className="section-head">
          <span className="kicker">vs Celery</span>
          <h2>One dependency, not three.</h2>
        </div>
        <div className="term cmp-term">
          <div className="langtabs">
            <button
              type="button"
              className={`langtab ${tab === "taskito" ? "active" : ""}`.trim()}
              onClick={() => setTab("taskito")}
            >
              taskito
            </button>
            <button
              type="button"
              className={`langtab ${tab === "celery" ? "active" : ""}`.trim()}
              onClick={() => setTab("celery")}
            >
              Celery
            </button>
          </div>
          <RawHtml as="pre" className="code" html={highlightPython(code)} />
        </div>
        <table className="md-table matrix delta">
          <thead>
            <tr>
              <th>&nbsp;</th>
              <th>taskito</th>
              <th>Celery</th>
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
    </section>
  );
}

export function Integrations() {
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <span className="kicker">Integrations</span>
          <h2>Fits your stack.</h2>
        </div>
        <div className="int-grid">
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
    <button
      type="button"
      className="install-pill"
      onClick={() => {
        navigator.clipboard?.writeText(cmd);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      <code>{cmd}</code>
      <span className="copyInstall">{copied ? "✓" : "Copy"}</span>
    </button>
  );
}

export function CTA() {
  return (
    <section className="section cta">
      <div className="cta-wrap">
        <h2>Ship background work in minutes.</h2>
        <p>One file, one worker. Pick your runtime:</p>
        <div className="install-row">
          <InstallPill cmd="pip install taskito" />
          <InstallPill cmd="pnpm add taskito" />
        </div>
        <div className="btns">
          <Link className="btn pri" to="/getting-started/installation">
            Get started →
          </Link>
          <Link className="btn sec" to="/node">
            Node.js SDK
          </Link>
        </div>
      </div>
    </section>
  );
}
