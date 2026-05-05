import { DiagramFrame, SKETCH_FILTER } from "./_primitives";

const FONT_MONO =
  'var(--font-mono), "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';

type Field = {
  name: string;
  type: string;
  key?: "PK" | "FK";
};

type EntitySchemaProps = {
  name: string;
  fields: Field[];
};

const ROW_H = 22;
const HEADER_H = 36;
const PAD_X = 18;
const SCHEMA_W = 360;

export function EntitySchema({ name, fields }: EntitySchemaProps) {
  const h = HEADER_H + fields.length * ROW_H + 14;
  return (
    <DiagramFrame
      ariaLabel={`${name} table schema`}
      width={SCHEMA_W}
      height={h}
      className="taskito-entity"
    >
      <rect
        x={2}
        y={2}
        width={SCHEMA_W - 4}
        height={h - 4}
        rx="10"
        fill="var(--color-fd-card)"
        stroke="var(--color-fd-sketch-strong)"
        strokeWidth="2"
        filter={SKETCH_FILTER}
      />
      <line
        x1={2}
        y1={HEADER_H}
        x2={SCHEMA_W - 2}
        y2={HEADER_H}
        stroke="var(--color-fd-sketch-strong)"
        strokeWidth="1.5"
        opacity="0.7"
        filter={SKETCH_FILTER}
      />
      <text
        x={PAD_X}
        y={HEADER_H - 12}
        fill="var(--color-fd-foreground)"
        fontSize="16"
        fontWeight="700"
      >
        {name}
      </text>
      <text
        x={SCHEMA_W - PAD_X}
        y={HEADER_H - 12}
        textAnchor="end"
        fill="var(--color-fd-muted-foreground)"
        fontSize="10"
        fontFamily={FONT_MONO}
        opacity="0.7"
      >
        table
      </text>

      {fields.map((field, i) => (
        <FieldRow
          key={field.name}
          field={field}
          y={HEADER_H + 16 + i * ROW_H}
        />
      ))}
    </DiagramFrame>
  );
}

function FieldRow({ field, y }: { field: Field; y: number }) {
  const tagX = SCHEMA_W - PAD_X - 30;
  const tagColor =
    field.key === "PK"
      ? "var(--color-fd-primary)"
      : "var(--color-fd-muted-foreground)";
  return (
    <g>
      <text
        x={PAD_X}
        y={y}
        fill="var(--color-fd-foreground)"
        fontSize="12"
        fontFamily={FONT_MONO}
      >
        {field.name}
      </text>
      <text
        x={SCHEMA_W - PAD_X - 36}
        y={y}
        textAnchor="end"
        fill="var(--color-fd-muted-foreground)"
        fontSize="11"
        fontFamily={FONT_MONO}
        opacity="0.85"
      >
        {field.type}
      </text>
      {field.key ? (
        <g>
          <rect
            x={tagX}
            y={y - 11}
            width={28}
            height={14}
            rx="4"
            fill="none"
            stroke={tagColor}
            strokeWidth="1.4"
          />
          <text
            x={tagX + 14}
            y={y - 1}
            textAnchor="middle"
            fill={tagColor}
            fontSize="9"
            fontWeight="700"
            fontFamily={FONT_MONO}
          >
            {field.key}
          </text>
        </g>
      ) : null}
    </g>
  );
}

type EntityRelationsProps = {
  caption?: string;
  relations: Array<{
    from: string;
    to: string;
    cardinality: string;
    label?: string;
  }>;
};

export function EntityRelations({ caption, relations }: EntityRelationsProps) {
  const names = Array.from(new Set(relations.flatMap((r) => [r.from, r.to])));
  const w = 600;
  const slotW = w / Math.max(names.length, 1);
  const boxW = Math.min(slotW - 24, 160);
  const boxH = 56;
  const topY = 40;
  const linkBaseY = topY + boxH + 50;
  const linkSpacing = 60;
  const h = topY + boxH + 60 + linkSpacing * relations.length;

  const xFor = (entity: string) => {
    const i = names.indexOf(entity);
    return slotW * i + slotW / 2;
  };

  return (
    <div className="my-4 not-prose flex flex-col items-center gap-2">
      <DiagramFrame
        ariaLabel="Table relationships"
        width={w}
        height={h}
        className="taskito-relations"
      >
        {names.map((name) => {
          const cx = xFor(name);
          return (
            <g key={name}>
              <rect
                x={cx - boxW / 2}
                y={topY}
                width={boxW}
                height={boxH}
                rx="10"
                fill="var(--color-fd-card)"
                stroke="var(--color-fd-sketch-strong)"
                strokeWidth="2"
                filter={SKETCH_FILTER}
              />
              <text
                x={cx}
                y={topY + boxH / 2 + 5}
                textAnchor="middle"
                fill="var(--color-fd-foreground)"
                fontSize="16"
                fontWeight="700"
                fontFamily={FONT_MONO}
              >
                {name}
              </text>
            </g>
          );
        })}

        {relations.map((rel, i) => {
          const x1 = xFor(rel.from);
          const x2 = xFor(rel.to);
          const y = linkBaseY + i * linkSpacing;
          const midX = (x1 + x2) / 2;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: relations are statically authored; index disambiguates same-pair duplicates
            <g key={`${rel.from}-${rel.to}-${i}`}>
              <path
                d={`M ${x1} ${topY + boxH} Q ${x1} ${y} ${midX} ${y} Q ${x2} ${y} ${x2} ${topY + boxH}`}
                fill="none"
                stroke="var(--color-fd-foreground)"
                strokeWidth="2.2"
                strokeDasharray="6 4"
                strokeLinecap="round"
                opacity="0.9"
              />
              <text
                x={midX}
                y={y - 8}
                textAnchor="middle"
                fill="var(--color-fd-foreground)"
                fontSize="13"
                fontWeight="500"
                fontFamily={FONT_MONO}
                opacity="0.95"
              >
                {rel.cardinality}
                {rel.label ? `  ·  ${rel.label}` : ""}
              </text>
            </g>
          );
        })}
      </DiagramFrame>
      {caption ? (
        <p className="text-xs text-fd-muted-foreground text-center">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
