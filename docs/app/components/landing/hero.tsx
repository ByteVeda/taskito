import { useState } from "react";
import { Link } from "react-router";
import { RawHtml } from "@/components/ui";
import { useSdk } from "@/hooks";
import { highlightPython, highlightTs } from "@/lib/highlight-lite";
import { HERO_PANES } from "@/lib/landing-content";

type Lang = "py" | "ts";

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
      <span className="lbl">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function Hero() {
  const { sdk, setSdk } = useSdk();
  // py/ts mirror the global SDK so the hero tab and the docs sidebar switch stay in sync.
  const isNode = sdk === "node";
  const lang: Lang = isNode ? "ts" : "py";
  const active = HERO_PANES.find((p) => p.id === lang) ?? HERO_PANES[0];
  const codeHtml =
    lang === "ts" ? highlightTs(active.code) : highlightPython(active.code);

  return (
    <section className="hero">
      <div className="left">
        <h1>
          One queue.
          <span className="grad">
            Built for {isNode ? "Node.js." : "Python."}
          </span>
        </h1>
        <p className="sub">
          A Rust-powered task queue with a first-class{" "}
          <b>{isNode ? "Node.js" : "Python"}</b> SDK over one core and one store
          — no broker. Start on <code>SQLite</code>, scale to{" "}
          <code>Postgres</code>.
        </p>
        <div className="btns">
          <Link className="btn pri" to={active.docHref}>
            Quickstart →
          </Link>
          <Link className="btn sec" to={`/${sdk}/getting-started/installation`}>
            Install
          </Link>
          <a className="btn gho" href="https://github.com/ByteVeda/taskito">
            GitHub ↗
          </a>
        </div>
        <div className="metarow">
          <span>Brokerless</span>
          <span>Rust core</span>
          <span>{isNode ? "Node.js SDK" : "Python SDK"}</span>
          <span>DAG workflows</span>
        </div>
      </div>

      <div className="right">
        <div className="term">
          <div className="tbar">
            <div className="dots">
              <i />
              <i />
              <i />
            </div>
            <div className="tabname">
              <b>{active.filename}</b>
            </div>
            <div className="runtag">
              <span className="ld" />
              worker · live
            </div>
          </div>
          <div className="langtabs">
            {HERO_PANES.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`langtab ${p.id === lang ? "active" : ""}`.trim()}
                onClick={() => setSdk(p.id === "ts" ? "node" : "python")}
              >
                {p.label}
              </button>
            ))}
            <button type="button" className="langtab" disabled>
              Java
              <span className="tag soon">Soon</span>
            </button>
            <CopyButton text={active.code} />
          </div>
          <div id="hero-panes">
            <RawHtml as="pre" className="code" html={codeHtml} />
          </div>
        </div>

        <div className="out">
          <div className="outset">
            {active.output.map((line) => (
              <div className="oline show" key={line.text}>
                <span className={line.glyphKind}>{line.glyph}</span>
                <span className="var">{line.text}</span>
                {line.value ? <span className="v">{line.value}</span> : null}
                {line.timing ? <span className="t">{line.timing}</span> : null}
              </div>
            ))}
          </div>
        </div>

        <div className="hero-doclinks">
          <Link
            className="hero-doclink"
            to="/python/getting-started/quickstart"
          >
            Read the Python quickstart →
          </Link>
          <Link className="hero-doclink" to="/node/getting-started/quickstart">
            Read the Node.js quickstart →
          </Link>
        </div>
      </div>
    </section>
  );
}
