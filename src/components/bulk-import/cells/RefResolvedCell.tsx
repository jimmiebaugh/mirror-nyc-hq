import { CELL_INPUT_CLASS, type CellEditorProps } from "./types";

/**
 * Editable raw-value cell for ref columns (client / venue / user emails).
 * Resolution happens in MapStep over the distinct values; this cell lets the
 * admin correct a raw value inline (a typo'd client name or email). Multi-value
 * columns hold pipe-separated tokens. The placeholder hints at the pipe syntax.
 */
export function RefResolvedCell({ value, col, onCommit }: CellEditorProps) {
  return (
    <input
      type="text"
      className={CELL_INPUT_CLASS}
      placeholder={col.multiValue ? "a@x.com | b@x.com" : undefined}
      value={value == null ? "" : String(value)}
      onChange={(e) => onCommit(e.target.value)}
    />
  );
}
