import { CELL_INPUT_CLASS, type CellEditorProps } from "./types";

/**
 * Date cell. Native `<input type="date">` so the committed value is always a
 * canonical `YYYY-MM-DD` string (the RPC casts `::date`). CSV values are ISO
 * per the template convention; a non-ISO value shows blank and the admin picks.
 */
export function DateCell({ value, onCommit }: CellEditorProps) {
  const iso = value == null ? "" : String(value);
  return (
    <input
      type="date"
      className={CELL_INPUT_CLASS}
      value={/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : ""}
      onChange={(e) => onCommit(e.target.value)}
    />
  );
}
