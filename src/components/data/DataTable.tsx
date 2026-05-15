import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { StatusToken } from "@/lib/home/projectStatusToken";

/**
 * Generic two-tier database list table. Lifts the Talent Scout
 * `CandidateTable.tsx` pattern: active rows above a "Complete & Cancelled"
 * divider, sort by clicking a header, status-color left border per row,
 * shift-click + checkbox range select, click-row navigates.
 *
 * Spec: OUTPUTS/phase-5-2-spec.md § 5.A.1 component contract.
 */

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Sort comparator (negative = a before b). Required to enable sort. */
  sort?: (a: T, b: T) => number;
};

export type SortState = { key: string; dir: "asc" | "desc" } | null;

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  rowBorderToken,
  onRowClick,
  selection,
  twoTier,
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  rowBorderToken?: (row: T) => StatusToken;
  onRowClick?: (row: T) => void;
  selection?: {
    selectedIds: Set<string>;
    onChange: (next: Set<string>) => void;
  };
  twoTier?: {
    isTerminal: (row: T) => boolean;
    dividerLabel: (n: number) => string;
  };
  empty?: { message: string; ctaLabel?: string; onCta?: () => void };
}) {
  const [sort, setSort] = useState<SortState>(null);
  const [collapsed, setCollapsed] = useState<boolean>(true);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const out = [...rows].sort(col.sort);
    return sort.dir === "asc" ? out : out.reverse();
  }, [rows, sort, columns]);

  const { active, terminal } = useMemo(() => {
    if (!twoTier) return { active: sortedRows, terminal: [] as T[] };
    const a: T[] = [];
    const t: T[] = [];
    for (const r of sortedRows) {
      if (twoTier.isTerminal(r)) t.push(r);
      else a.push(r);
    }
    return { active: a, terminal: t };
  }, [sortedRows, twoTier]);

  const toggleHeaderSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const toggleRowSelection = (row: T, shift: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (shift && lastSelectedId) {
      const ids = sortedRows.map((r) => r.id);
      const a = ids.indexOf(lastSelectedId);
      const b = ids.indexOf(row.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) next.add(ids[i]);
      } else {
        next.add(row.id);
      }
    } else {
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
    }
    selection.onChange(next);
    setLastSelectedId(row.id);
  };

  const renderRow = (row: T) => {
    const token = rowBorderToken?.(row);
    const checked = selection?.selectedIds.has(row.id) ?? false;
    return (
      <tr
        key={row.id}
        data-row-token={token}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-row-checkbox]")) return;
          onRowClick?.(row);
        }}
      >
        {selection ? (
          <td onClick={(e) => e.stopPropagation()} data-row-checkbox className="w-[34px]">
            <span
              role="checkbox"
              aria-checked={checked}
              onClick={(e) => toggleRowSelection(row, e.shiftKey)}
              className="inline-block"
            >
              <Checkbox checked={checked} />
            </span>
          </td>
        ) : null}
        {columns.map((c) => (
          <td
            key={c.key}
            className={c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""}
          >
            {c.render(row)}
          </td>
        ))}
      </tr>
    );
  };

  if (rows.length === 0 && empty) {
    return (
      <div className="hq-dt-empty">
        <p className="text-sm">{empty.message}</p>
        {empty.ctaLabel && empty.onCta ? (
          <button
            type="button"
            onClick={empty.onCta}
            className="mt-4 inline-flex items-center rounded-md border border-[hsl(var(--border-strong))] px-3 py-1.5 text-sm hover:border-primary"
          >
            {empty.ctaLabel}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <table className="hq-dt">
      <thead>
        <tr>
          {selection ? <th className="w-[34px]"></th> : null}
          {columns.map((c) => {
            const isSorted = sort?.key === c.key;
            const arrow = isSorted ? (sort?.dir === "asc" ? "↑" : "↓") : "";
            return (
              <th
                key={c.key}
                className={`${c.align === "right" ? "r" : c.align === "center" ? "c" : ""} ${c.sort ? "sortable" : ""}`}
                onClick={() => c.sort && toggleHeaderSort(c.key)}
              >
                {c.label} {arrow}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {active.map(renderRow)}
        {twoTier && terminal.length > 0 ? (
          <>
            <tr className="hq-dt-divider">
              <td colSpan={columns.length + (selection ? 1 : 0)}>
                <button
                  type="button"
                  onClick={() => setCollapsed((v) => !v)}
                  className="flex items-center gap-2"
                >
                  <span>{collapsed ? "▸" : "▾"}</span>
                  <span>{twoTier.dividerLabel(terminal.length)}</span>
                </button>
              </td>
            </tr>
            {!collapsed ? terminal.map(renderRow) : null}
          </>
        ) : null}
      </tbody>
    </table>
  );
}
