import { CELL_INPUT_CLASS, type CellEditorProps } from "./types";

/** Closed-enum cell (Status). Native select over the column's enumValues.
 *  Blank is allowed; the commit RPC defaults a blank status to "Queued". */
export function EnumCell({ value, col, onCommit }: CellEditorProps) {
  const current = value == null ? "" : String(value);
  return (
    <select
      className={`${CELL_INPUT_CLASS} cursor-pointer`}
      value={current}
      onChange={(e) => onCommit(e.target.value)}
    >
      <option value="">—</option>
      {(col.enumValues ?? []).map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}
