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
  /**
   * Phase 5.7.5 follow-up round 2: optional group label rendered in a
   * top-tier header row spanning all consecutive same-group columns.
   * Used by the Deliverables grouped list to put a merged "Due" header
   * over the relative-label + actual-date sub-columns.
   */
  group?: string;
  /**
   * Phase 5.16.1.1 (Frontend #29): optional `title` tooltip on the column
   * header `<th>`. Used by ClientsList "Active Projects" to surface the
   * active-only filter rule on hover.
   */
  headerTitle?: string;
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
  quickAdd,
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
  /**
   * Phase 5.7.7 followup-1: optional in-table quick-add CTA row. Renders
   * at the bottom of the active list (right above the `twoTier` divider
   * if present, otherwise at the bottom of the table). Clicking calls
   * `onClick`; the parent owns the insert + the resulting row appears
   * in the rendered list via the `rows` prop on next render.
   */
  quickAdd?: { label: string; onClick: () => void | Promise<void>; disabled?: boolean };
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
          const alignCls = c.align === "r" ? "r" : c.align === "c" ? "c" : c.align === "l" ? "l" : "";
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

  // Walk columns left-to-right and build header "runs": each ungrouped
  // column is its own single-cell run; each maximal sequence of
  // consecutive same-group columns is a merged run rendered as one
  // colspanned <th> with the group label. Renders as a SINGLE thead
  // row (no second tier) so the merged group header sits on the same
  // line as the surrounding ungrouped column headers, matching the
  // screenshot expectation from 5.7.5 round 2 follow-up.
  type HeaderRun =
    | { kind: "col"; col: Column<T>; key: string }
    | { kind: "group"; label: string; span: number; firstCol: Column<T>; key: string };
  const headerRuns: HeaderRun[] = [];
  for (let i = 0; i < columns.length; ) {
    const c = columns[i];
    if (!c.group) {
      headerRuns.push({ kind: "col", col: c, key: c.key });
      i += 1;
      continue;
    }
    let span = 1;
    while (i + span < columns.length && columns[i + span].group === c.group) span += 1;
    headerRuns.push({
      kind: "group",
      label: c.group,
      span,
      firstCol: c,
      key: `__grp-${i}-${c.group}`,
    });
    i += span;
  }

  return (
    <div className="tbl-wrap">
      <table className={`tbl ${flat ? "tbl--flat" : ""}`}>
        <thead>
          <tr>
            {headerRuns.map((run) => {
              if (run.kind === "group") {
                const c = run.firstCol;
                const isSorted = sort?.key === c.key;
                return (
                  <th
                    key={run.key}
                    colSpan={run.span}
                    className="c"
                    style={{
                      cursor: c.sort ? "pointer" : undefined,
                      color: isSorted ? "hsl(var(--foreground))" : undefined,
                    }}
                    onClick={() => c.sort && toggleHeaderSort(c.key)}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {run.label}
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
              }
              const c = run.col;
              const isSorted = sort?.key === c.key;
              const alignCls = c.align === "r" ? "r" : c.align === "c" ? "c" : c.align === "l" ? "l" : "";
              const dividerCls = c.noRightDivider ? "tbl-cell-nodivider" : "";
              const className = [alignCls, dividerCls].filter(Boolean).join(" ") || undefined;
              return (
                <th
                  key={c.key}
                  className={className}
                  title={c.headerTitle}
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
          {quickAdd ? (
            <tr className="tbl-quickadd">
              <td colSpan={totalCols}>
                <button
                  type="button"
                  onClick={() => {
                    void quickAdd.onClick();
                  }}
                  disabled={quickAdd.disabled}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    padding: "10px 14px",
                    textAlign: "left",
                    cursor: quickAdd.disabled ? "default" : "pointer",
                    color: "hsl(var(--muted-foreground))",
                    fontSize: 12.5,
                    font: "inherit",
                  }}
                >
                  + {quickAdd.label}
                </button>
              </td>
            </tr>
          ) : null}
          {twoTier && terminal.length > 0 ? (
            <>
              <tr className="tbl-done">
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
