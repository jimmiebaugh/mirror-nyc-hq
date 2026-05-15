import { useState, type ReactNode } from "react";
import type { StatusToken } from "@/lib/home/projectStatusToken";

/**
 * Kanban board view for HQ Core list pages. Each `BoardRow` is a
 * collapsible group of columns; each column is a status (or other group
 * value) carrying a stack of cards. Drag-drop is HTML5 native:
 * `onDrop(row, fromColumnId, toColumnId)` fires when a card lands on a
 * different column.
 *
 * Spec: § 5.A.2 (Projects 4-row stacked layout), § 5.B.2 (Tasks Status
 * board), § 5.C.3 (Deliverables grouped-by-project board). The component
 * is generic across all three.
 */

export type BoardColumn<T extends { id: string }> = {
  id: string;
  label: string;
  token?: StatusToken;
  rows: T[];
};

export type BoardRow<T extends { id: string }> = {
  label: string;
  columns: BoardColumn<T>[];
};

const TOKEN_COLOR: Record<StatusToken, string> = {
  info: "#06B6D4",
  success: "hsl(var(--success))",
  warn: "hsl(var(--warn))",
  destructive: "hsl(var(--destructive))",
  muted: "hsl(var(--border-strong))",
};

export function BoardView<T extends { id: string }>({
  rows,
  renderCard,
  onCardMove,
  onCardClick,
  columnsPerRow,
}: {
  rows: BoardRow<T>[];
  renderCard: (row: T) => ReactNode;
  onCardMove?: (row: T, fromColumnId: string, toColumnId: string) => void;
  onCardClick?: (row: T) => void;
  /** Override the auto grid template by row index (else evenly split). */
  columnsPerRow?: (rowIdx: number) => number;
}) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [dragFrom, setDragFrom] = useState<string | null>(null);

  return (
    <div className="hq-board">
      {rows.map((row, ri) => {
        const isCollapsed = collapsed[ri] === true;
        const cols = columnsPerRow?.(ri) ?? row.columns.length;
        return (
          <div key={`${row.label}-${ri}`}>
            <div className="hq-board-rowhead">
              <button
                type="button"
                onClick={() => setCollapsed((m) => ({ ...m, [ri]: !isCollapsed }))}
                className="hq-board-rowhead-title flex items-center gap-2"
              >
                <span>{isCollapsed ? "▸" : "▾"}</span>
                <span>{row.label}</span>
              </button>
            </div>
            {!isCollapsed ? (
              <div
                className="hq-board-cols"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {row.columns.map((col) => (
                  <div
                    key={col.id}
                    className="hq-board-col"
                    onDragOver={(e) => {
                      if (dragFrom && dragFrom !== col.id) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (!dragFrom || !onCardMove) return;
                      const rowId = e.dataTransfer.getData("text/plain");
                      if (!rowId || dragFrom === col.id) return;
                      const source = rows
                        .flatMap((r) => r.columns)
                        .find((c) => c.id === dragFrom)?.rows.find((r) => r.id === rowId);
                      if (source) onCardMove(source, dragFrom, col.id);
                      setDragFrom(null);
                    }}
                  >
                    <div className="hq-board-col-head">
                      <span
                        className="hq-board-col-dot"
                        style={{ background: col.token ? TOKEN_COLOR[col.token] : TOKEN_COLOR.muted }}
                      />
                      <span>{col.label}</span>
                      <span className="ml-auto text-[hsl(var(--subtle-foreground))]">
                        {col.rows.length}
                      </span>
                    </div>
                    {col.rows.length === 0 ? (
                      <div className="text-[11px] text-[hsl(var(--subtle-foreground))] italic px-2 py-3">
                        empty
                      </div>
                    ) : (
                      col.rows.map((card) => (
                        <div
                          key={card.id}
                          className="hq-board-card"
                          draggable={Boolean(onCardMove)}
                          onDragStart={(e) => {
                            setDragFrom(col.id);
                            e.dataTransfer.setData("text/plain", card.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => setDragFrom(null)}
                          onClick={() => onCardClick?.(card)}
                        >
                          {renderCard(card)}
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
