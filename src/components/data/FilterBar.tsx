import { useState } from "react";

/**
 * Notion-style chip-builder filter bar. Each chip is a (field, op, value)
 * triple; the chip strip carries an AND / OR connector toggle that
 * applies to every chip in the strip.
 *
 * Spec: OUTPUTS/phase-5-2-spec.md § 5.A.1 (component contract). Locked
 * decisions § 4: "is any of" multi-value chips render the values comma-
 * separated inside the chip body.
 *
 * Adding a chip opens an inline popover with the field picker, then op
 * picker, then value entry. To stay simple in 5.2.1 the value entry uses a
 * text input or a comma-separated multi-value input; richer value pickers
 * (user picker, enum select, date range) drop in here over time.
 */

export type FilterChip = {
  field: string;
  op: string;
  value: string | string[];
};

export type FilterState = {
  connector: "AND" | "OR";
  chips: FilterChip[];
};

export type FilterFieldDef = {
  key: string;
  label: string;
  type: "text" | "enum" | "user" | "date";
  options?: string[];
};

const OPS_FOR_TYPE: Record<FilterFieldDef["type"], string[]> = {
  text: ["is", "is not", "contains"],
  enum: ["is", "is not", "is any of"],
  user: ["is", "is not"],
  date: ["is", "is before", "is after"],
};

export function emptyFilterState(): FilterState {
  return { connector: "AND", chips: [] };
}

export function FilterBar({
  state,
  onChange,
  fields,
}: {
  entityType?: string;
  state: FilterState;
  onChange: (next: FilterState) => void;
  fields: FilterFieldDef[];
}) {
  const [building, setBuilding] = useState<{
    field?: FilterFieldDef;
    op?: string;
  } | null>(null);
  const [valueDraft, setValueDraft] = useState("");

  const toggleConnector = () => {
    onChange({ ...state, connector: state.connector === "AND" ? "OR" : "AND" });
  };

  const removeChip = (i: number) => {
    onChange({ ...state, chips: state.chips.filter((_, idx) => idx !== i) });
  };

  const commit = () => {
    if (!building?.field || !building?.op || !valueDraft.trim()) {
      setBuilding(null);
      setValueDraft("");
      return;
    }
    const value: string | string[] = building.op === "is any of"
      ? valueDraft.split(",").map((s) => s.trim()).filter(Boolean)
      : valueDraft.trim();
    onChange({
      ...state,
      chips: [...state.chips, { field: building.field.key, op: building.op, value }],
    });
    setBuilding(null);
    setValueDraft("");
  };

  const fieldLabel = (key: string) => fields.find((f) => f.key === key)?.label ?? key;

  return (
    <div className="hq-filterbar">
      {state.chips.map((c, i) => (
        <span key={`${c.field}-${i}`} className="hq-filterchip">
          <span className="hq-filterchip-field">{fieldLabel(c.field)}</span>
          <span className="hq-filterchip-op">{c.op}</span>
          <span>{Array.isArray(c.value) ? c.value.join(", ") : c.value}</span>
          <span
            role="button"
            className="hq-filterchip-x"
            onClick={() => removeChip(i)}
            aria-label={`Remove filter ${fieldLabel(c.field)}`}
          >
            ×
          </span>
        </span>
      ))}
      {state.chips.length >= 2 ? (
        <button
          type="button"
          className="hq-filterchip--connector"
          onClick={toggleConnector}
          title="Toggle AND / OR"
        >
          {state.connector}
        </button>
      ) : null}
      {building ? (
        <span className="hq-filterchip">
          {!building.field ? (
            <select
              autoFocus
              className="bg-transparent text-foreground"
              onChange={(e) => {
                const f = fields.find((x) => x.key === e.target.value);
                if (f) setBuilding({ field: f });
              }}
              defaultValue=""
            >
              <option value="" disabled>
                Field...
              </option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          ) : !building.op ? (
            <>
              <span className="hq-filterchip-field">{building.field.label}</span>
              <select
                autoFocus
                className="bg-transparent text-foreground"
                onChange={(e) => setBuilding({ ...building, op: e.target.value })}
                defaultValue=""
              >
                <option value="" disabled>
                  Op...
                </option>
                {OPS_FOR_TYPE[building.field.type].map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <span className="hq-filterchip-field">{building.field.label}</span>
              <span className="hq-filterchip-op">{building.op}</span>
              {building.field.options && building.field.type === "enum" && building.op !== "is any of" ? (
                <select
                  autoFocus
                  className="bg-transparent text-foreground"
                  value={valueDraft}
                  onChange={(e) => setValueDraft(e.target.value)}
                  onBlur={commit}
                >
                  <option value="" disabled>
                    Value...
                  </option>
                  {building.field.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  autoFocus
                  className="bg-transparent text-foreground outline-none w-40"
                  value={valueDraft}
                  placeholder={building.op === "is any of" ? "a, b, c" : "value"}
                  onChange={(e) => setValueDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") {
                      setBuilding(null);
                      setValueDraft("");
                    }
                  }}
                  onBlur={commit}
                />
              )}
            </>
          )}
        </span>
      ) : (
        <button
          type="button"
          className="hq-filterchip--add"
          onClick={() => setBuilding({})}
        >
          + Add filter
        </button>
      )}
    </div>
  );
}
