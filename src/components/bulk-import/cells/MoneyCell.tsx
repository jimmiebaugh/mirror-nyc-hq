import { useState } from "react";
import { CELL_INPUT_CLASS, type CellEditorProps } from "./types";

/**
 * Money cell. Accepts `$340,000` or `340000` interchangeably; commits the
 * canonical bare numeric string (so the RPC's `::numeric` cast succeeds) and
 * renders `$340,000` when not focused.
 */
function toNumericString(raw: string): string {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return "";
  return Number.isNaN(Number(cleaned)) ? raw.trim() : cleaned;
}

function formatMoney(numeric: string): string {
  if (numeric === "") return "";
  const n = Number(numeric);
  if (Number.isNaN(n)) return numeric;
  return `$${n.toLocaleString("en-US")}`;
}

export function MoneyCell({ value, onCommit }: CellEditorProps) {
  const stored = value == null ? "" : String(value);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(stored);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={CELL_INPUT_CLASS}
      value={focused ? draft : formatMoney(stored)}
      onFocus={() => {
        setDraft(stored);
        setFocused(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const next = toNumericString(draft);
        if (next !== stored) onCommit(next);
      }}
    />
  );
}
