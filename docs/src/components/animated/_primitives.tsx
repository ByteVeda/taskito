import type { ReactNode } from "react";

const FILTER_ID = "taskito-sketch-filter";
const ARROW_ID = "taskito-sketch-arrow";
const ARROW_SOFT_ID = "taskito-sketch-arrow-soft";

export const SKETCH_FILTER = `url(#${FILTER_ID})`;
export const SKETCH_ARROW = `url(#${ARROW_ID})`;
export const SKETCH_ARROW_SOFT = `url(#${ARROW_SOFT_ID})`;

const FONT_MONO =
  'var(--font-mono), "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';

/**
 * Sketch defs (filter + arrow markers). Render once inside each diagram's
 * `<defs>`. URL references collide intentionally — every diagram uses the
 * same filter/marker IDs so the sketch aesthetic stays consistent.
 */
export function SketchDefs() {
  return (
    <>
      <filter id={FILTER_ID}>
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.025"
          numOctaves="2"
          seed="3"
        />
        <feDisplacementMap in="SourceGraphic" scale="0.7" />
      </filter>
      <ArrowMarker id={ARROW_ID} stroke="var(--color-fd-foreground)" />
      <ArrowMarker
        id={ARROW_SOFT_ID}
        stroke="var(--color-fd-muted-foreground)"
      />
    </>
  );
}

function ArrowMarker({ id, stroke }: { id: string; stroke: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 12 12"
      refX="9"
      refY="6"
      markerWidth="6"
      markerHeight="6"
      orient="auto"
    >
      <path
        d="M 1 1 L 10 6 L 1 11"
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </marker>
  );
}

/* -------------------------------------------------------------------------- *
 * Frame
 * -------------------------------------------------------------------------- */

export type DiagramFrameProps = {
  ariaLabel: string;
  width: number;
  height: number;
  className: string;
  children: ReactNode;
};

/** Outer wrapper. Centers the SVG, applies handwritten font, defines defs. */
export function DiagramFrame({
  ariaLabel,
  width,
  height,
  className,
  children,
}: DiagramFrameProps) {
  return (
    <div className="my-6 not-prose flex justify-center">
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${width} ${height}`}
        className={`w-full max-w-3xl font-sans ${className}`}
      >
        <defs>
          <SketchDefs />
        </defs>
        {children}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * NodeBox
 * -------------------------------------------------------------------------- */

export type NodeVariant = "default" | "primary" | "terminal" | "muted";

export type NodeBoxProps = {
  cx: number;
  cy: number;
  w?: number;
  h?: number;
  label: string;
  hint?: string;
  variant?: NodeVariant;
  rx?: number;
  className?: string;
};

const NODE_W = 110;
const NODE_H = 44;

export function NodeBox({
  cx,
  cy,
  w = NODE_W,
  h = NODE_H,
  label,
  hint,
  variant = "default",
  rx,
  className,
}: NodeBoxProps) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const isPrimary = variant === "primary";
  const isTerminal = variant === "terminal";
  const isMuted = variant === "muted";

  const stroke = isPrimary
    ? "var(--color-fd-primary)"
    : isMuted
      ? "var(--color-fd-muted-foreground)"
      : "var(--color-fd-sketch-strong)";
  const strokeWidth = isPrimary ? 2.5 : 2;
  const radius = rx ?? (isTerminal ? Math.min(h / 2, 22) : 9);

  return (
    <g className={className}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={radius}
        fill="var(--color-fd-card)"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={isMuted ? "4 4" : undefined}
        opacity={isMuted ? 0.85 : 1}
        filter={SKETCH_FILTER}
      />
      {isTerminal ? (
        <rect
          x={x + 4}
          y={y + 4}
          width={w - 8}
          height={h - 8}
          rx={radius - 4}
          fill="none"
          stroke="var(--color-fd-sketch-strong)"
          strokeWidth="1.2"
          opacity="0.5"
          filter={SKETCH_FILTER}
        />
      ) : null}
      <text
        x={cx}
        y={hint ? cy - 2 : cy + 5}
        textAnchor="middle"
        fill="var(--color-fd-foreground)"
        fontSize="14"
        fontWeight="600"
      >
        {label}
      </text>
      {hint ? (
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fill="var(--color-fd-muted-foreground)"
          fontSize="9"
          fontFamily={FONT_MONO}
          opacity="0.9"
        >
          {hint}
        </text>
      ) : null}
    </g>
  );
}

/* -------------------------------------------------------------------------- *
 * Cylinder (DB shape)
 * -------------------------------------------------------------------------- */

export type CylinderProps = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  label?: string;
};

export function Cylinder({ cx, cy, rx, ry, label }: CylinderProps) {
  const lipR = Math.min(ry / 4, 8);
  const stroke = "var(--color-fd-sketch-strong)";
  return (
    <g>
      <ellipse
        cx={cx}
        cy={cy + ry - lipR}
        rx={rx}
        ry={lipR}
        fill="var(--color-fd-card)"
        stroke={stroke}
        strokeWidth="2"
        filter={SKETCH_FILTER}
      />
      <line
        x1={cx - rx}
        y1={cy - ry + lipR}
        x2={cx - rx}
        y2={cy + ry - lipR}
        stroke={stroke}
        strokeWidth="2"
        filter={SKETCH_FILTER}
      />
      <line
        x1={cx + rx}
        y1={cy - ry + lipR}
        x2={cx + rx}
        y2={cy + ry - lipR}
        stroke={stroke}
        strokeWidth="2"
        filter={SKETCH_FILTER}
      />
      <ellipse
        cx={cx}
        cy={cy - ry + lipR}
        rx={rx}
        ry={lipR}
        fill="var(--color-fd-card)"
        stroke={stroke}
        strokeWidth="2"
        filter={SKETCH_FILTER}
      />
      {label ? (
        <text
          x={cx}
          y={cy + 5}
          textAnchor="middle"
          fill="var(--color-fd-foreground)"
          fontSize="14"
          fontWeight="600"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

/* -------------------------------------------------------------------------- *
 * Panel (labeled container)
 * -------------------------------------------------------------------------- */

export type PanelProps = {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  rx?: number;
};

export function Panel({ x, y, w, h, label, rx = 14 }: PanelProps) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={rx}
        fill="var(--color-fd-card)"
        stroke="var(--color-fd-sketch-strong)"
        strokeWidth="1.5"
        strokeDasharray="3 5"
        opacity="0.4"
        filter={SKETCH_FILTER}
      />
      {label ? (
        <g>
          <rect
            x={x + 12}
            y={y - 8}
            width={label.length * 7 + 12}
            height={14}
            fill="var(--color-fd-background)"
          />
          <text
            x={x + 18}
            y={y + 3}
            fill="var(--color-fd-foreground)"
            fontSize="11"
            fontFamily={FONT_MONO}
            fontWeight="600"
            letterSpacing="0.12em"
            opacity="1"
          >
            {label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

/* -------------------------------------------------------------------------- *
 * Arrow
 * -------------------------------------------------------------------------- */

export type ArrowVariant = "default" | "muted";

export type ArrowProps = {
  /** SVG path data. Use a straight line via "M x1 y1 L x2 y2", or any path. */
  d: string;
  variant?: ArrowVariant;
  label?: string;
  labelX?: number;
  labelY?: number;
  labelAnchor?: "start" | "middle" | "end";
};

export function Arrow({
  d,
  variant = "default",
  label,
  labelX,
  labelY,
  labelAnchor = "middle",
}: ArrowProps) {
  const muted = variant === "muted";
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={
          muted
            ? "var(--color-fd-muted-foreground)"
            : "var(--color-fd-foreground)"
        }
        strokeWidth={muted ? 2 : 2.4}
        strokeDasharray={muted ? "4 4" : "6 4"}
        strokeLinecap="round"
        opacity={muted ? 0.6 : 0.9}
        markerEnd={muted ? SKETCH_ARROW_SOFT : SKETCH_ARROW}
      />
      {label !== undefined && labelX !== undefined && labelY !== undefined ? (
        <Caption x={labelX} y={labelY} anchor={labelAnchor} text={label} />
      ) : null}
    </g>
  );
}

/* -------------------------------------------------------------------------- *
 * Caption (small monospace label)
 * -------------------------------------------------------------------------- */

export type CaptionProps = {
  x: number;
  y: number;
  text: string;
  anchor?: "start" | "middle" | "end";
  size?: number;
};

export function Caption({
  x,
  y,
  text,
  anchor = "middle",
  size = 10,
}: CaptionProps) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill="var(--color-fd-foreground)"
      fontSize={size}
      fontFamily={FONT_MONO}
      opacity="0.95"
    >
      {text}
    </text>
  );
}

/* -------------------------------------------------------------------------- *
 * Lifeline (for sequence diagrams)
 * -------------------------------------------------------------------------- */

export type LifelineProps = {
  x: number;
  y1: number;
  y2: number;
};

export function Lifeline({ x, y1, y2 }: LifelineProps) {
  return (
    <line
      x1={x}
      y1={y1}
      x2={x}
      y2={y2}
      stroke="var(--color-fd-sketch-strong)"
      strokeWidth="1.4"
      strokeDasharray="3 6"
      opacity="0.4"
    />
  );
}

/* -------------------------------------------------------------------------- *
 * MotionStyles — emits keyframes + base styles unconditionally and gates
 * animation rules behind prefers-reduced-motion: no-preference.
 * -------------------------------------------------------------------------- */

export type MotionStylesProps = {
  /** Always emitted. Define @keyframes, base opacity:0 styles, etc. */
  base: string;
  /** Wrapped in @media (prefers-reduced-motion: no-preference). */
  animations: string;
};

export function MotionStyles({ base, animations }: MotionStylesProps) {
  return (
    <style>{`
${base}
@media (prefers-reduced-motion: no-preference) {
${animations}
}
`}</style>
  );
}
