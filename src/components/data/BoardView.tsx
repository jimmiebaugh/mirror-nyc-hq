import { useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronRight } from "@/components/icons/HQIcons";
import type { StatusToken } from "@/lib/home/projectStatusToken";

/**
 * Kanban board view for HQ Core list pages. Wireframe-fidelity rebuild
 * (Phase 5.2.1 Revision); two layouts driven by the `layout` prop:
 *
 * - `horizontal` (Tasks, Deliverables): `.board > .bcol` flex with
 *   overflow-x:auto scroll. Wireframe lines 2281-2363 + the spec-rewritten
 *   Deliverables board (§ 4.C.2: one column per project).
 * - `stacked` (Projects): `.board-stack > .board-rowhead + .board-row > .bcol`
 *   collapsible row groups. Wireframe Surface 05 lines 1106-1202.
 *
 * Drag-drop: HTML5 native. Cards `draggable=true` carry `data-row-id`;
 * columns are drop targets. `onCardMove(row, fromColumnId, toColumnId)`
 * fires on drop into a different column. Parent runs optimistic + revert.
 */

const TOKEN_COLOR: Record<StatusToken, string> = {
  info: "#06B6D4",
  success: "hsl(var(--success))",
  warn: "hsl(var(--warn))",
  destructive: "hsl(var(--destructive))",
  muted: "hsl(var(--border-strong))",
  purple: "#B57BF5",
};

export type BoardColumn<T extends { id: string }> = {
  id: string;
  label: string;
  token?: StatusToken;
  rows: T[];
  /** Optional CTA inside the column footer (`.bcol-add`). */
  addLabel?: string;
  onAdd?: () => void;
};

export type BoardRow<T extends { id: string }> = {
  label: string;
  /** Right-side caption shown next to the row title (e.g. "4 columns"). */
  rowCaption?: string;
  columns: BoardColumn<T>[];
};

export type BoardLayout = "horizontal" | "stacked";

export function BoardView<T extends { id: string }>({
  layout,
  rows,
  renderCard,
  onCardMove,
  onCardClick,
}: {
  layout: BoardLayout;
  rows: BoardRow<T>[];
  renderCard: (row: T, column: BoardColumn<T>) => ReactNode;
  onCardMove?: (row: T, fromColumnId: string, toColumnId: string) => void;
  onCardClick?: (row: T) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [dragFrom, setDragFrom] = useState<string | null>(null);

  const renderColumn = (col: BoardColumn<T>) => (
    <div
      key={col.id}
      className="bcol"
      onDragOver={(e) => {
        if (dragFrom && dragFrom !== col.id) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!dragFrom || !onCardMove) return;
        const rowId = e.dataTransfer.getData("text/plain");
        if (!rowId || dragFrom === col.id) return;
        const source = rows
          .flatMap((r) => r.columns)
          .find((c) => c.id === dragFrom)
          ?.rows.find((r) => r.id === rowId);
        if (source) onCardMove(source, dragFrom, col.id);
        setDragFrom(null);
      }}
    >
      <div className="bcol-head">
        <span
          className="dt"
          style={{ background: col.token ? TOKEN_COLOR[col.token] : TOKEN_COLOR.muted }}
        />
        <span className="ttl">{col.label}</span>
        <span className="ct" style={{ marginLeft: "auto" }}>
          {col.rows.length}
        </span>
      </div>
      <div className="bcol-body">
        {col.rows.length === 0 ? (
          <div className="cap" style={{ padding: "10px 4px", fontStyle: "italic" }}>
            empty
          </div>
        ) : (
          col.rows.map((card) => (
            <div
              key={card.id}
              className={`bcard ${col.token ? `rb-${col.token}` : ""}`}
              draggable={Boolean(onCardMove)}
              onDragStart={(e) => {
                setDragFrom(col.id);
                e.dataTransfer.setData("text/plain", card.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragFrom(null)}
              onClick={() => onCardClick?.(card)}
            >
              {renderCard(card, col)}
            </div>
          ))
        )}
      </div>
      {col.addLabel || col.onAdd ? (
        <div
          className="bcol-add"
          role="button"
          onClick={col.onAdd}
        >
          {col.addLabel ?? "+ Add"}
        </div>
      ) : null}
    </div>
  );

  if (layout === "horizontal") {
    const columns = rows.flatMap((r) => r.columns);
    return <div className="board">{columns.map(renderColumn)}</div>;
  }

  return (
    <div className="board-stack">
      {rows.map((row, ri) => {
        const isCollapsed = collapsed[ri] === true;
        const Chev = isCollapsed ? IconChevronRight : IconChevronDown;
        return (
          <div key={`${row.label}-${ri}`}>
            <div
              className="board-rowhead"
              role="button"
              onClick={() =>
                setCollapsed((m) => ({ ...m, [ri]: !isCollapsed }))
              }
            >
              <Chev className="ic" />
              <span className="rl">{row.label}</span>
              {row.rowCaption ? (
                <span className="rc">{row.rowCaption}</span>
              ) : null}
            </div>
            {!isCollapsed ? (
              <div className="board-row">{row.columns.map(renderColumn)}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
