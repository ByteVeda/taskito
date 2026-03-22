import type { ComponentChildren } from "preact";

export interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => ComponentChildren);
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  children?: ComponentChildren;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  rowKey?: (row: T) => string;
  onSelectionChange?: (keys: Set<string>) => void;
}

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  children,
  selectable,
  selectedKeys,
  rowKey,
  onSelectionChange,
}: DataTableProps<T>) {
  const allKeys = selectable && rowKey ? data.map(rowKey) : [];
  const allSelected =
    selectable && allKeys.length > 0 && allKeys.every((k) => selectedKeys?.has(k));

  const toggleAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? new Set() : new Set(allKeys));
  };

  const toggleRow = (key: string) => {
    if (!onSelectionChange || !selectedKeys) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  };

  return (
    <div class="dark:bg-surface-2 bg-white rounded-xl shadow-sm dark:shadow-black/20 overflow-hidden border dark:border-white/[0.06] border-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {selectable && (
                <th class="w-10 text-center px-3 py-2.5 dark:bg-surface-3/50 bg-slate-50 border-b dark:border-white/[0.04] border-slate-100">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    class="accent-accent cursor-pointer"
                  />
                </th>
              )}
              {columns.map((col, i) => (
                <th
                  key={i}
                  class={`text-left px-4 py-2.5 dark:bg-surface-3/50 bg-slate-50 text-muted font-semibold text-[11px] uppercase tracking-[0.05em] whitespace-nowrap border-b dark:border-white/[0.04] border-slate-100 ${col.className ?? ""}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, ri) => {
              const key = selectable && rowKey ? rowKey(row) : String(ri);
              const isSelected = selectedKeys?.has(key);
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  class={`border-b dark:border-white/[0.03] border-slate-50 last:border-0 transition-colors duration-100 ${
                    ri % 2 === 1 ? "dark:bg-white/[0.01] bg-slate-50/30" : ""
                  } ${isSelected ? "dark:bg-accent/[0.08] bg-accent/[0.04]" : ""} ${
                    onRowClick
                      ? "cursor-pointer hover:dark:bg-accent/[0.04] hover:bg-accent/[0.02]"
                      : ""
                  }`}
                >
                  {selectable && (
                    <td class="w-10 text-center px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(key)}
                        onClick={(e) => e.stopPropagation()}
                        class="accent-accent cursor-pointer"
                      />
                    </td>
                  )}
                  {columns.map((col, ci) => (
                    <td key={ci} class={`px-4 py-3 whitespace-nowrap ${col.className ?? ""}`}>
                      {typeof col.accessor === "function"
                        ? col.accessor(row)
                        : (row[col.accessor] as ComponentChildren)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {children}
    </div>
  );
}
