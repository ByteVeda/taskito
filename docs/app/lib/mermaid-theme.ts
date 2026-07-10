// Central Mermaid theming: base node/edge colors (aligned to tokens.css, dark +
// light) plus a semantic class palette. `applyDiagramTheme()` strips author
// `classDef`s and injects these, so charts only name states (`A:::failed`). Hex
// mirrors tokens.css — Mermaid bakes classDef colors into the SVG — keep in sync.

export type DiagramTheme = "dark" | "light";

// --- base theme variables (default nodes, edges, clusters, sequences) --------

const DARK_VARIABLES = {
  darkMode: true,
  background: "transparent",
  primaryColor: "#13131d", // panel2 — default node fill
  primaryTextColor: "#ececf4", // txt
  primaryBorderColor: "#33334a", // line3-ish
  lineColor: "#5c5c70", // dim — edges
  secondaryColor: "#181824", // panel3
  tertiaryColor: "#0f0f17", // panel
  mainBkg: "#13131d",
  nodeBkg: "#13131d",
  nodeBorder: "#33334a",
  nodeTextColor: "#ececf4",
  clusterBkg: "#0c0c13", // bg-soft
  clusterBorder: "#1f5e3c", // brand-green tint
  edgeLabelBackground: "#0f0f17",
  titleColor: "#ececf4",
  labelTextColor: "#ececf4",
  textColor: "#ececf4",
  noteBkgColor: "#181824",
  noteTextColor: "#ececf4",
  noteBorderColor: "#3bbf72",
  errorBkgColor: "#331a1c",
  errorTextColor: "#ff9d9d",
  attributeBackgroundColorOdd: "#13131d",
  attributeBackgroundColorEven: "#0f0f17",
  altBackground: "#181824",
  labelBackground: "#0f0f17",
  actorBkg: "#13131d",
  actorBorder: "#3bbf72",
  actorTextColor: "#ececf4",
  actorLineColor: "#5c5c70",
  signalColor: "#ececf4",
  signalTextColor: "#ececf4",
  // Badge circle is filled with signalColor (near-white here); use dark text.
  sequenceNumberColor: "#08080c",
  labelBoxBkgColor: "#13131d",
  labelBoxBorderColor: "#33334a",
  loopTextColor: "#ececf4",
  activationBkgColor: "#181824",
  activationBorderColor: "#5c5c70",
} as const;

const LIGHT_VARIABLES = {
  darkMode: false,
  background: "transparent",
  primaryColor: "#ffffff",
  primaryTextColor: "#1b1a15", // txt
  primaryBorderColor: "#cfc9ba",
  lineColor: "#8b877a", // dim
  secondaryColor: "#f2efe7", // panel2
  tertiaryColor: "#eae5da", // panel3
  mainBkg: "#ffffff",
  nodeBkg: "#ffffff",
  nodeBorder: "#cfc9ba",
  nodeTextColor: "#1b1a15",
  clusterBkg: "#fbf9f3", // bg-soft
  clusterBorder: "#10a152", // brand green
  edgeLabelBackground: "#ffffff",
  titleColor: "#1b1a15",
  labelTextColor: "#1b1a15",
  textColor: "#1b1a15",
  noteBkgColor: "#f2efe7",
  noteTextColor: "#1b1a15",
  noteBorderColor: "#10a152",
  errorBkgColor: "#fbe3e3",
  errorTextColor: "#911b1b",
  attributeBackgroundColorOdd: "#ffffff",
  attributeBackgroundColorEven: "#f2efe7",
  altBackground: "#f2efe7",
  labelBackground: "#ffffff",
  actorBkg: "#ffffff",
  actorBorder: "#10a152",
  actorTextColor: "#1b1a15",
  actorLineColor: "#8b877a",
  signalColor: "#1b1a15",
  signalTextColor: "#1b1a15",
  // Badge circle is filled with signalColor (near-black here); use light text.
  sequenceNumberColor: "#ffffff",
  labelBoxBkgColor: "#ffffff",
  labelBoxBorderColor: "#cfc9ba",
  loopTextColor: "#1b1a15",
  activationBkgColor: "#f2efe7",
  activationBorderColor: "#8b877a",
} as const;

export function diagramThemeVariables(theme: DiagramTheme) {
  return theme === "dark" ? DARK_VARIABLES : LIGHT_VARIABLES;
}

// --- erDiagram entity styling (not covered by theme variables) ---------------

const DARK_THEME_CSS = `
  .er.entityBox { fill: #13131d !important; stroke: #33334a !important; }
  .er.entityLabel { fill: #ececf4 !important; }
  .er.attributeBoxOdd { fill: #13131d !important; }
  .er.attributeBoxEven { fill: #0f0f17 !important; }
  .er .er.attribute-text,
  .er .attribute-text,
  .er text { fill: #ececf4 !important; }
  .er.relationshipLabel,
  .er.relationshipLabelBox { fill: #ececf4 !important; }
  .er.relationshipLabelBox + text { fill: #0f0f17 !important; }
`;

const LIGHT_THEME_CSS = `
  .er.entityBox { fill: #ffffff !important; stroke: #cfc9ba !important; }
  .er.entityLabel { fill: #1b1a15 !important; }
  .er.attributeBoxOdd { fill: #ffffff !important; }
  .er.attributeBoxEven { fill: #f2efe7 !important; }
  .er .er.attribute-text,
  .er .attribute-text,
  .er text { fill: #1b1a15 !important; }
`;

export function diagramThemeCss(theme: DiagramTheme): string {
  return theme === "dark" ? DARK_THEME_CSS : LIGHT_THEME_CSS;
}

// --- semantic node palette ---------------------------------------------------

interface NodeStyle {
  fill: string;
  stroke: string;
  color: string;
  /** Extra `classDef` props, e.g. a dashed border for nested/terminal nodes. */
  extra?: string;
}

/** Canonical states. Every chart should style nodes with one of these (or an
 *  alias below). Add a state here — not in an MDX file — to extend the palette. */
const PALETTE: Record<DiagramTheme, Record<string, NodeStyle>> = {
  dark: {
    success: { fill: "#14301e", stroke: "#3bbf72", color: "#86e3aa" },
    failed: { fill: "#331a1c", stroke: "#ff6b6b", color: "#ff9d9d" },
    skipped: { fill: "#181824", stroke: "#3a3a48", color: "#9a9ab0" },
    waiting: { fill: "#33270f", stroke: "#ffb86b", color: "#ffd29c" },
    active: { fill: "#0e2b29", stroke: "#29b8a8", color: "#6fd6cb" },
    gate: { fill: "#2f2410", stroke: "#f0a850", color: "#ffce9e" },
    sink: { fill: "#0e2b29", stroke: "#29b8a8", color: "#6fd6cb" },
    sub: {
      fill: "#0e2b29",
      stroke: "#29b8a8",
      color: "#6fd6cb",
      extra: "stroke-dasharray:5",
    },
    terminal: {
      fill: "#13131d",
      stroke: "#5c5c70",
      color: "#c3c2d4",
      extra: "stroke-dasharray:4",
    },
  },
  light: {
    success: { fill: "#dcf5e6", stroke: "#10a152", color: "#0a5e30" },
    failed: { fill: "#fbe3e3", stroke: "#dc2626", color: "#911b1b" },
    skipped: { fill: "#ece9e1", stroke: "#bdb9ab", color: "#5c5849" },
    waiting: { fill: "#f7ead4", stroke: "#c2410c", color: "#7a2e0a" },
    active: { fill: "#d4efeb", stroke: "#0d9488", color: "#0a5a52" },
    gate: { fill: "#f9edd2", stroke: "#b45309", color: "#7a3d05" },
    sink: { fill: "#d4efeb", stroke: "#0d9488", color: "#0a5a52" },
    sub: {
      fill: "#d4efeb",
      stroke: "#0d9488",
      color: "#0a5a52",
      extra: "stroke-dasharray:5",
    },
    terminal: {
      fill: "#f2efe7",
      stroke: "#8b877a",
      color: "#35332c",
      extra: "stroke-dasharray:4",
    },
  },
};

// Author-facing aliases → canonical state. Keeps existing charts working
// (Python used `failed`/`success`/`skipped`; Node used `fail`/`done`/`skip`/…)
// and lets new charts use whichever name reads best.
const ALIASES: Record<string, string> = {
  done: "success",
  ok: "success",
  complete: "success",
  completed: "success",
  source: "success",
  pass: "success",
  fail: "failed",
  error: "failed",
  dead: "failed",
  skip: "skipped",
  cancelled: "skipped",
  canceled: "skipped",
  pending: "waiting",
  queued: "waiting",
  run: "active",
  running: "active",
  current: "active",
  approval: "gate",
  info: "sink",
  comp: "sub",
  compensation: "sub",
};

function classDefLine(name: string, style: NodeStyle): string {
  const props = [
    `fill:${style.fill}`,
    `stroke:${style.stroke}`,
    `color:${style.color}`,
    style.extra,
  ]
    .filter(Boolean)
    .join(",");
  return `classDef ${name} ${props}`;
}

/** Canonical + alias `classDef` lines for the theme. Appended to every
 *  flowchart; unused definitions are harmless. */
function semanticClassDefs(theme: DiagramTheme): string {
  const palette = PALETTE[theme];
  const lines = Object.entries(palette).map(([name, style]) =>
    classDefLine(name, style),
  );
  for (const [alias, target] of Object.entries(ALIASES)) {
    lines.push(classDefLine(alias, palette[target]));
  }
  return lines.join("\n");
}

// Only flowcharts support `classDef`/`:::`. Injecting into sequence/er/state/etc.
// would be a parse error, so those charts are returned untouched.
function isFlowchart(chart: string): boolean {
  const first = chart.trim().split(/\s+/, 1)[0]?.toLowerCase();
  return first === "graph" || first === "flowchart";
}

const CLASSDEF_LINE = /^[ \t]*classDef[ \t].*$/gm;

/** Normalize a chart to the central theme: drop author `classDef`s and inject
 *  the canonical, theme-aware palette. Non-flowchart diagrams pass through. */
export function applyDiagramTheme(chart: string, theme: DiagramTheme): string {
  if (!isFlowchart(chart)) {
    return chart;
  }
  const stripped = chart.replace(CLASSDEF_LINE, "").replace(/\n{3,}/g, "\n\n");
  return `${stripped.trimEnd()}\n${semanticClassDefs(theme)}\n`;
}
