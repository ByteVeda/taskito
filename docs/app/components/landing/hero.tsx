import { useState } from "react";
import { Link } from "react-router";
import { RawHtml } from "@/components/ui";
import { highlightPython, highlightTs } from "@/lib/highlight-lite";
import { HERO_PANES, SOON_LANGS } from "@/lib/landing-content";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="hcopy"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1300);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function Hero() {
  const [lang, setLang] = useState<"py" | "ts">("py");
  const pane = HERO_PANES.find((p) => p.id === lang) ?? HERO_PANES[0];
  const codeHtml =
    lang === "py" ? highlightPython(pane.code) : highlightTs(pane.code);

  return (
    <section className="hero">
      <div className="hero-left">
        <span className="eyebrow">
          <span className="dot" /> Rust-powered · Python &amp; Node.js
        </span>
        <h1>One queue. Python and Node.</h1>
        <p className="sub">
          A brokerless, Rust-powered task queue with first-class Python and
          Node.js SDKs over one core and store. No Redis, no RabbitMQ — just a
          file and a worker.
        </p>
        <div className="btns">
          <Link className="btn pri" to={pane.docHref}>
            Get started →
          </Link>
          <a
            className="btn sec"
            href="https://github.com/ByteVeda/taskito"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
        <div className="metarow">
          <span>MIT licensed</span>
          <span>SQLite · Postgres · Redis</span>
          <span>v0.16</span>
        </div>
      </div>

      <div className="hero-right">
        <div className="term">
          <div className="langtabs" data-langtabs>
            {HERO_PANES.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`langtab ${p.id === lang ? "active" : ""}`.trim()}
                onClick={() => setLang(p.id)}
              >
                {p.label}
              </button>
            ))}
            {SOON_LANGS.map((s) => (
              <span key={s} className="langtab dis">
                {s} <span className="tag soon">soon</span>
              </span>
            ))}
            <span className="tabname" id="hero-fn">
              {pane.filename}
            </span>
            <CopyButton text={pane.code} />
          </div>
          <RawHtml as="pre" className="code" html={codeHtml} />
          <div className="outset" id="out">
            {pane.output.map((line) => (
              <div key={line} className="oline show">
                {line}
              </div>
            ))}
          </div>
        </div>
        <Link className="hero-doclink" to={pane.docHref}>
          {pane.docLabel} →
        </Link>
      </div>
    </section>
  );
}
