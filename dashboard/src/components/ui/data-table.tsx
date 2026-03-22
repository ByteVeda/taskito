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
}

export function DataTable<T>({ columns, data, onRowClick, children }: DataTableProps<T>) {
  return (
    <div class="dark:bg-surface-2 bg-white rounded-xl shadow-sm dark:shadow-black/20 overflow-hidden border dark:border-white/[0.06] border-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  class={`text-left px-4 py-3 dark:bg-surface-3/50 bg-slate-50 text-muted font-semibold text-[11px] uppercase tracking-[0.05em] whitespace-nowrap border-b dark:border-white/[0.04] border-slate-100 ${col.className ?? ""}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, ri) => (
              <tr
                key={ri}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                class={`border-b dark:border-white/[0.03] border-slate-50 last:border-0 transition-colors duration-100 ${
                  ri % 2 === 1 ? "dark:bg-white/[0.01] bg-slate-50/30" : ""
                } ${
                  onRowClick
                    ? "cursor-pointer hover:dark:bg-accent/[0.04] hover:bg-accent/[0.02]"
                    : ""
                }`}
              >
                {columns.map((col, ci) => (
                  <td key={ci} class={`px-4 py-3 whitespace-nowrap ${col.className ?? ""}`}>
                    {typeof col.accessor === "function"
                      ? col.accessor(row)
                      : (row[col.accessor] as ComponentChildren)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {children}
    </div>
  );
}
