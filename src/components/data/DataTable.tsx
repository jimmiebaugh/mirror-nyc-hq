import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
} from "@/components/icons/HQIcons";
import type { StatusToken } from "@/lib/home/projectStatusToken";

/**
 * Generic two-tier database list table. Wireframe-fidelity rebuild
 * (Phase 5.2.1 Revision); renders the canonical `.tbl-wrap > .tbl[.tbl--flat]
 * > thead/tbody > tr.rb-<token>` structure from
 * OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1025-1047.
 *
 * `flat` true => add `.tbl--flat` so the colored row left-border is
 * stripped (Project / Task / Deliverable top-level lists; the wireframe
 * revision at line 306-307 calls for this).
 */

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: "l" | "c" | "r";
  width?: string | number;
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
  flat = false,
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
  flat?: boolean;
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

  const renderRow = (row: T, terminalRow: boolean) => {
    const token = rowBorderToken?.(row);
    const checked = selection?.selectedIds.has(row.id) ?? false;
    return (
      <tr
        key={row.id}
        className={token ? `rb-${token}` : undefined}
        style={{
          cursor: onRowClick ? "pointer" : undefined,
          opacity: terminalRow ? 0.6 : undefined,
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-row-checkbox]")) return;
          onRowClick?.(row);
        }}
      >
        {selection ? (
          <td
            className="c"
            style={{ width: 38 }}
            data-row-checkbox
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className={`checkbox ${checked ? "checkbox--on" : ""}`}
              role="checkbox"
              aria-checked={checked}
              onClick={(e) =>
                toggleRowSelection(row, (e as React.MouseEvent).shiftKey)
              }
            >
              {checked ? <IconCheck className="ic" /> : null}
            </span>
          </td>
        ) : null}
        {columns.map((c) => (
          <td
            key={c.key}
            className={c.align === "r" ? "r" : c.align === "c" ? "c" : ""}
            style={c.width ? { width: c.width } : undefined}
          >
            {c.render(row)}
          </td>
        ))}
      </tr>
    );
  };

  if (rows.length === 0 && empty) {
    return (
      <div className="empty">
        <p>{empty.message}</p>
        {empty.ctaLabel && empty.onCta ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={empty.onCta}
          >
            {empty.ctaLabel}
          </button>
        ) : null}
      </div>
    );
  }

  const totalCols = columns.length + (selection ? 1 : 0);

  return (
    <div className="tbl-wrap">
      <table className={`tbl ${flat ? "tbl--flat" : ""}`}>
        <thead>
          <tr>
            {selection ? <th style={{ width: 38 }}><span className="checkbox" /></th> : null}
            {columns.map((c) => {
              const isSorted = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  className={c.align === "r" ? "r" : c.align === "c" ? "c" : ""}
                  style={{
                    width: c.width,
                    cursor: c.sort ? "pointer" : undefined,
                    color: isSorted ? "hsl(var(--foreground))" : undefined,
                  }}
                  onClick={() => c.sort && toggleHeaderSort(c.key)}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {c.label}
                    {isSorted ? (
                      <IconChevronDown
                        className="ic"
                        style={{
                          width: 9,
                          height: 9,
                          transform: sort?.dir === "asc" ? "rotate(180deg)" : undefined,
                        }}
                      />
                    ) : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {active.map((r) => renderRow(r, false))}
          {twoTier && terminal.length > 0 ? (
            <>
              <tr className="tbl-divider">
                <td colSpan={totalCols}>
                  <button
                    type="button"
                    className="row-c"
                    style={{
                      gap: 6,
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: "inherit",
                      font: "inherit",
                    }}
                    onClick={() => setCollapsed((v) => !v)}
                  >
                    {collapsed ? (
                      <IconChevronRight className="ic" style={{ width: 10, height: 10 }} />
                    ) : (
                      <IconChevronDown className="ic" style={{ width: 10, height: 10 }} />
                    )}
                    {twoTier.dividerLabel(terminal.length)}
                  </button>
                </td>
              </tr>
              {!collapsed ? terminal.map((r) => renderRow(r, true)) : null}
            </>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
