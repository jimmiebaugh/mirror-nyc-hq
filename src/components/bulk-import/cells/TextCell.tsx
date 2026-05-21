import { CELL_INPUT_CLASS, type CellEditorProps } from "./types";

export function TextCell({ value, onCommit }: CellEditorProps) {
  return (
    <input
      type="text"
      className={CELL_INPUT_CLASS}
      value={value == null ? "" : String(value)}
      onChange={(e) => onCommit(e.target.value)}
    />
  );
}
