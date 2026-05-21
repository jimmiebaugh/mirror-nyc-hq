import type { ColumnSchema } from "@/lib/hq/bulkImport/types";

/**
 * Shared props for every per-kind cell editor (Phase 5.9.2). The grid owns
 * keyboard nav + row state; cells just render an editor for one value and
 * commit string changes via `onCommit`. Validation styling (red ring) is
 * applied by the grid wrapper, not the cell.
 */
export type CellEditorProps = {
  value: unknown;
  col: ColumnSchema;
  /** Stable per-cell id (`${rowIndex}-${col.key}`) for datalist wiring. */
  instanceId: string;
  onCommit: (next: string) => void;
};

export const CELL_INPUT_CLASS =
  "w-full bg-transparent outline-none focus:bg-surface text-sm";
