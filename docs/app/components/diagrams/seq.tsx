// Sequence strip — exact port of the prototype's `.seq` (paired actor heads +
// directional message rows). Used on `architecture/mesh.mdx` for the local
// deque and the work-stealing protocol.

type SeqRow =
  | { self: string }
  | { left?: string; right?: string; rev?: boolean };

export function Seq({ heads, rows }: { heads: string[]; rows: SeqRow[] }) {
  return (
    <div className="seq">
      <div className="seq-heads">
        {heads.map((h) => (
          <div className="seq-head" key={h}>
            {h}
          </div>
        ))}
      </div>
      <div className="seq-msgs">
        {rows.map((row, i) =>
          "self" in row ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed sequence rows
            <div className="seq-msg" key={i}>
              <span className="self">{row.self}</span>
            </div>
          ) : (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed sequence rows
              key={i}
              className={`seq-msg ${row.rev ? "rev" : ""}`.trim()}
            >
              {row.left != null ? (
                <span className="lbl">{row.left}</span>
              ) : null}
              <span className="ln" />
              {row.right != null ? (
                <span className="lbl">{row.right}</span>
              ) : null}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
