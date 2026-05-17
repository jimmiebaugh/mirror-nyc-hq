import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
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
  /**
   * Phase 5.7.4 smoke round 2: suppress the vertical divider on this
   * cell's right edge. Used by PeopleList Affiliation so the pill cell
   * sits flush against Name without a separator line.
   */
  noRightDivider?: boolean;
  /**
   * Phase 5.7.4 smoke round 5: optional inline style applied to the
   * <th> only (not the body cells). Used by ProjectsList "Job #" to
   * reduce the header padding so the label fits on one line without
   * touching cell padding.
   */
  headerStyle?: CSSProperties;
};

export type SortState = { key: string; dir: "asc" | "desc" } | null;

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  rowBorderToken,
  onRowClick,
  twoTier,
  flat = false,
  empty,
  sort: controlledSort,
  onSortChange,
}: {
  rows: T[];
  columns: Column<T>[];
  rowBorderToken?: (row: T) => StatusToken;
  onRowClick?: (row: T) => void;
  twoTier?: {
    isTerminal: (row: T) => boolean;
    dividerLabel: (n: number) => string;
  };
  flat?: boolean;
  empty?: { message: string; ctaLabel?: string; onCta?: () => void };
  /**
   * Phase 5.6.5 (Projects-first carry-forward): when both props are
   * provided, sort becomes controlled — the parent owns the SortState
   * (typically inside `filterState.sort` so saved views round-trip it).
   * Omit both to keep the legacy internal-state behavior.
   */
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
}) {
  const isControlledSort = onSortChange !== undefined;
  const [internalSort, setInternalSort] = useState<SortState>(null);
  const sort = isControlledSort ? controlledSort ?? null : internalSort;
  const setSort = (next: SortState | ((prev: SortState) => SortState)) => {
    if (isControlledSort) {
      const value = typeof next === "function" ? next(sort) : next;
      onSortChange?.(value);
    } else {
      setInternalSort(next);
    }
  };
  const [collapsed, setCollapsed] = useState<boolean>(true);

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

  const renderRow = (row: T, terminalRow: boolean) => {
    const token = rowBorderToken?.(row);
    return (
      <tr
        key={row.id}
        className={token ? `rb-${token}` : undefined}
        style={{
          cursor: onRowClick ? "pointer" : undefined,
          opacity: terminalRow ? 0.6 : undefined,
        }}
        onClick={() => onRowClick?.(row)}
      >
        {columns.map((c) => {
          const alignCls = c.align === "r" ? "r" : c.align === "c" ? "c" : "";
          const dividerCls = c.noRightDivider ? "tbl-cell-nodivider" : "";
          const className = [alignCls, dividerCls].filter(Boolean).join(" ") || undefined;
          return (
            <td
              key={c.key}
              className={className}
              style={c.width ? { width: c.width } : undefined}
            >
              {c.render(row)}
            </td>
          );
        })}
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

  const totalCols = columns.length;

  return (
    <div className="tbl-wrap">
      <table className={`tbl ${flat ? "tbl--flat" : ""}`}>
        <thead>
          <tr>
            {columns.map((c) => {
              const isSorted = sort?.key === c.key;
              const alignCls = c.align === "r" ? "r" : c.align === "c" ? "c" : "";
              const dividerCls = c.noRightDivider ? "tbl-cell-nodivider" : "";
              const className = [alignCls, dividerCls].filter(Boolean).join(" ") || undefined;
              return (
                <th
                  key={c.key}
                  className={className}
                  style={{
                    width: c.width,
                    cursor: c.sort ? "pointer" : undefined,
                    color: isSorted ? "hsl(var(--foreground))" : undefined,
                    ...c.headerStyle,
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
                      <IconChevronRight className="ic" style={{ width: 16, height: 16 }} />
                    ) : (
                      <IconChevronDown className="ic" style={{ width: 16, height: 16 }} />
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
