import { useLookup, type LookupTable } from "@/lib/hq/lookups";
import { CELL_INPUT_CLASS, type CellEditorProps } from "./types";

/**
 * Free-text cell with autocomplete suggestions from a shared lookup table
 * (Category -> project_categories, City -> cities). The value is stored as
 * plain text; novel values auto-create the lookup row server-side inside the
 * commit RPC (locked auto-create), so this cell never writes to the DB itself.
 * A `<datalist>` provides the suggestions without forcing a choice.
 */
export function LookupCell({ value, col, instanceId, onCommit }: CellEditorProps) {
  const lookup = useLookup((col.lookupTable ?? "cities") as LookupTable);
  const listId = `lookup-${instanceId}`;
  return (
    <>
      <input
        type="text"
        list={listId}
        className={CELL_INPUT_CLASS}
        value={value == null ? "" : String(value)}
        onChange={(e) => onCommit(e.target.value)}
      />
      <datalist id={listId}>
        {lookup.options.map((o) => (
          <option key={o.id} value={o.name} />
        ))}
      </datalist>
    </>
  );
}
