import { useRef, useState } from "react";
import { IconX } from "@/components/icons/HQIcons";

/**
 * Lightweight tag editor for the inline-edit-on-detail-pages pattern
 * (Phase 5.6.3). Renders chips with an X to remove, plus a text input
 * that adds a new tag on Enter.
 *
 * Differs from the older `<MultiTagInput>` (which fronts a typeahead
 * over a lookup table with an inline "+ Add" AlertDialog): tags here are
 * free-text with no backing table, so the heavier picker is overkill.
 *
 * Save semantics: `onChange` fires on every add / remove; caller persists
 * with an optimistic UI + rollback toast.
 */

export type InlineTagInputProps = {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

export function InlineTagInput({
  values,
  onChange,
  placeholder = "Type tag + enter",
}: InlineTagInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (values.includes(t)) {
      setDraft("");
      return;
    }
    onChange([...values, t]);
    setDraft("");
  };

  const remove = (v: string) => {
    onChange(values.filter((x) => x !== v));
  };

  return (
    <div
      className="row-c wrap"
      style={{ gap: 6, alignItems: "center", minWidth: 0 }}
    >
      {values.map((v) => (
        <span
          key={v}
          className="tag"
          style={{ display: "inline-flex", gap: 5, alignItems: "center" }}
        >
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => remove(v)}
            style={{
              background: "transparent",
              border: 0,
              cursor: "pointer",
              color: "inherit",
              padding: 0,
              display: "inline-flex",
            }}
          >
            <IconX className="ic" style={{ width: 10, height: 10 }} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="input"
        style={{
          height: 28,
          fontSize: 12,
          padding: "2px 8px",
          width: 120,
          minWidth: 0,
          flex: "1 1 120px",
          background: "transparent",
        }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            // Backspace on empty input removes the trailing chip (Notion + Gmail pattern).
            remove(values[values.length - 1]);
          }
        }}
        placeholder={placeholder}
      />
    </div>
  );
}
