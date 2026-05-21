import { CELL_INPUT_CLASS, type CellEditorProps } from "./types";

/** Non-negative numeric cell. Commits the raw string; the grid validator
 *  flags non-numeric / negative values. */
export function NumberCell({ value, onCommit }: CellEditorProps) {
  return (
    <input
      type="text"
      inputMode="numeric"
      className={CELL_INPUT_CLASS}
      value={value == null ? "" : String(value)}
      onChange={(e) => onCommit(e.target.value)}
    />
  );
}
