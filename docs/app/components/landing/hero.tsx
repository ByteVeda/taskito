import { useState } from "react";
import { Link } from "react-router";
import { RawHtml } from "@/components/ui";
import { useSdk } from "@/hooks";
import { highlightPython, highlightTs } from "@/lib/highlight-lite";
import { HERO_PANES, SOON_PANES, type SoonLang } from "@/lib/landing-content";

type Lang = "py" | "ts" | "go" | "java";

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

function SoonBox({ pane }: { pane: SoonLang }) {
  return (
    <div className="soonbox">
      <div className="ring" />
      <h4>{pane.heading}</h4>
      <p>{pane.body}</p>
      <span className="gh">github.com/ByteVeda/taskito</span>
    </div>
  );
}

export function Hero() {
  const { sdk, setSdk } = useSdk();
  // Roadmap langs (go/java) have no SDK — selected locally; py/ts mirror the
  // global SDK so the hero tab and the docs sidebar switch stay in sync.
  const [soon, setSoon] = useState<SoonLang["id"] | null>(null);
  const lang: Lang = soon ?? (sdk === "node" ? "ts" : "py");
  const isNode = sdk === "node";
  const pane = HERO_PANES.find((p) => p.id === lang);
  const codeHtml = pane
    ? lang === "ts"
      ? highlightTs(pane.code)
      : highlightPython(pane.code)
    : "";
  const active = pane ?? HERO_PANES[0];

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
                onClick={() => {
                  setSoon(null);
                  setSdk(p.id === "ts" ? "node" : "python");
                }}
              >
                {p.label}
              </button>
            ))}
            {SOON_PANES.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`langtab dis ${p.id === lang ? "active" : ""}`.trim()}
                onClick={() => setSoon(p.id)}
              >
                {p.label} <span className="tag soon">soon</span>
              </button>
            ))}
            {pane ? <CopyButton text={pane.code} /> : null}
          </div>
          <div id="hero-panes">
            {pane ? (
              <RawHtml as="pre" className="code" html={codeHtml} />
            ) : (
              <SoonBox
                pane={SOON_PANES.find((p) => p.id === lang) ?? SOON_PANES[0]}
              />
            )}
          </div>
        </div>

        {pane ? (
          <div className="out">
            <div className="outset">
              {pane.output.map((line) => (
                <div className="oline show" key={line.text}>
                  <span className={line.glyphKind}>{line.glyph}</span>
                  <span className="var">{line.text}</span>
                  {line.value ? <span className="v">{line.value}</span> : null}
                  {line.timing ? (
                    <span className="t">{line.timing}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="hero-doclinks">
          <Link
            className="hero-doclink"
            to="/python/getting-started/quickstart"
          >
            Read the Python quickstart →
          </Link>
          <Link className="hero-doclink" to="/node/getting-started/quickstart">
            Read the TypeScript quickstart →
          </Link>
        </div>
      </div>
    </section>
  );
}
