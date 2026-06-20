/** Print a value as pretty JSON. */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Print rows as an aligned text table, or `(none)` when empty. */
export function printTable(rows: Array<Record<string, unknown>>, columns?: string[]): void {
  const first = rows[0];
  if (!first) {
    process.stdout.write("(none)\n");
    return;
  }
  const cols = columns ?? Object.keys(first);
  const widths = cols.map((col) =>
    Math.max(col.length, ...rows.map((row) => String(row[col] ?? "").length)),
  );
  const renderRow = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ");

  const lines = [renderRow(cols), renderRow(widths.map((w) => "-".repeat(w)))];
  for (const row of rows) {
    lines.push(renderRow(cols.map((col) => String(row[col] ?? ""))));
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}
