import { Fragment, useEffect, useRef, useState } from "react";
import {
  IconFilter,
  IconX,
  IconPlus,
  IconChevronDown,
} from "@/components/icons/HQIcons";

/**
 * Notion-style chip-builder filter bar. Wireframe-fidelity rebuild
 * (Phase 5.2.1 Revision); renders the `.filterbar > .fchip [.k .op .v .x]`
 * structure from OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1002-1010
 * (with the `.andor` connector between chips + the trailing `.fchip--add`).
 *
 * The "add filter" popover is the field/op/value picker. Inputs inside use
 * `.input` per the wireframe pattern, not shadcn Select.
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

export type FilterLookupOption = {
  id: string;
  name: string;
  /** Optional short label shown after the name in the picker (e.g. "Client"). */
  sublabel?: string;
};

export type FilterFieldDef = {
  key: string;
  label: string;
  type: "text" | "enum" | "user" | "date" | "lookup";
  options?: string[];
  /**
   * Required for `type: "lookup"`. The picker shows these as a dropdown;
   * the chip stores the picked `id` as its value. Chip display resolves
   * the id back to `name` via this list.
   */
  lookupOptions?: FilterLookupOption[];
  /**
   * When true, this field def participates in chip label resolution but is
   * NOT offered in the + Add filter popover. Used for surfaces that ship a
   * default chip (e.g. Tasks `assigneeId is Me`) whose underlying field
   * doesn't have a usable add-popover input yet.
   */
  hidden?: boolean;
};

const OPS_FOR_TYPE: Record<FilterFieldDef["type"], string[]> = {
  text: ["is", "is not", "contains"],
  enum: ["is", "is not", "is any of"],
  user: ["is", "is not"],
  date: ["is", "is before", "is after"],
  lookup: ["is", "is not"],
};

export function emptyFilterState(): FilterState {
  return { connector: "AND", chips: [] };
}

export function FilterBar({
  state,
  onChange,
  fields,
}: {
  state: FilterState;
  onChange: (next: FilterState) => void;
  fields: FilterFieldDef[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [building, setBuilding] = useState<{
    field?: FilterFieldDef;
    op?: string;
    value?: string;
  }>({});
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) {
        setAddOpen(false);
        setBuilding({});
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [addOpen]);

  const fieldLabel = (key: string) =>
    fields.find((f) => f.key === key)?.label ?? key;

  /**
   * Lookup chips store the picked option's id as their value (uuid). For
   * display, resolve id -> name via the field's lookupOptions so the chip
   * reads as the human-readable picked name, not a bare uuid.
   */
  const chipDisplayValue = (chip: FilterChip): string => {
    const def = fields.find((f) => f.key === chip.field);
    if (def?.type === "lookup" && def.lookupOptions) {
      const raw = Array.isArray(chip.value) ? chip.value[0] : chip.value;
      const match = def.lookupOptions.find((o) => o.id === raw);
      if (match) return match.name;
      return raw;
    }
    return Array.isArray(chip.value) ? chip.value.join(", ") : chip.value;
  };

  const removeChip = (i: number) => {
    onChange({ ...state, chips: state.chips.filter((_, idx) => idx !== i) });
  };

  const toggleConnector = () => {
    onChange({
      ...state,
      connector: state.connector === "AND" ? "OR" : "AND",
    });
  };

  const commit = () => {
    if (!building.field || !building.op || !building.value?.trim()) return;
    const value: string | string[] =
      building.op === "is any of"
        ? building.value.split(",").map((s) => s.trim()).filter(Boolean)
        : building.value.trim();
    onChange({
      ...state,
      chips: [
        ...state.chips,
        { field: building.field.key, op: building.op, value },
      ],
    });
    setAddOpen(false);
    setBuilding({});
  };

  return (
    <div className="filterbar">
      <IconFilter className="ic" style={{ width: 14, height: 14, color: "hsl(var(--subtle-foreground))" }} />

      {state.chips.map((chip, i) => (
        <Fragment key={i}>
          <span className="fchip">
            <span className="k">{fieldLabel(chip.field)}</span>
            <span className="op">{chip.op}</span>
            <span className="v">{chipDisplayValue(chip)}</span>
            <span
              className="x"
              role="button"
              aria-label={`Remove filter ${fieldLabel(chip.field)}`}
              onClick={() => removeChip(i)}
            >
              <IconX className="ic" style={{ width: 11, height: 11 }} />
            </span>
          </span>
          {i < state.chips.length - 1 ? (
            <span
              className="andor"
              role="button"
              title="Toggle AND / OR"
              onClick={toggleConnector}
            >
              {state.connector}
              <IconChevronDown className="ic" style={{ width: 8, height: 8, marginLeft: 3 }} />
            </span>
          ) : null}
        </Fragment>
      ))}

      <span ref={popRef} style={{ position: "relative" }}>
        <span
          className="fchip fchip--add"
          role="button"
          onClick={() => {
            setAddOpen((v) => !v);
            if (!addOpen) setBuilding({});
          }}
        >
          <span>
            <IconPlus className="ic" style={{ width: 11, height: 11, marginRight: 5 }} />
            Add filter
          </span>
        </span>

        {addOpen ? (
          <div
            className="card card-pad"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              zIndex: 30,
              minWidth: 280,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <select
              className="input"
              style={{ height: 36 }}
              autoFocus
              value={building.field?.key ?? ""}
              onChange={(e) => {
                const f = fields.find((x) => x.key === e.target.value);
                setBuilding({ field: f, op: undefined, value: "" });
              }}
            >
              <option value="" disabled>
                Field...
              </option>
              {fields.filter((f) => !f.hidden).map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>

            {building.field ? (
              <select
                className="input"
                style={{ height: 36 }}
                value={building.op ?? ""}
                onChange={(e) =>
                  setBuilding((b) => ({ ...b, op: e.target.value, value: "" }))
                }
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
            ) : null}

            {building.field && building.op ? (
              building.field.type === "lookup" &&
              building.field.lookupOptions ? (
                <select
                  className="input"
                  style={{ height: 36 }}
                  value={building.value ?? ""}
                  onChange={(e) =>
                    setBuilding((b) => ({ ...b, value: e.target.value }))
                  }
                >
                  <option value="" disabled>
                    Value...
                  </option>
                  {building.field.lookupOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.sublabel ? `${o.name} (${o.sublabel})` : o.name}
                    </option>
                  ))}
                </select>
              ) : building.field.type === "enum" &&
                building.field.options &&
                building.op !== "is any of" ? (
                <select
                  className="input"
                  style={{ height: 36 }}
                  value={building.value ?? ""}
                  onChange={(e) =>
                    setBuilding((b) => ({ ...b, value: e.target.value }))
                  }
                >
                  <option value="" disabled>
                    Value...
                  </option>
                  {building.field.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  style={{ height: 36 }}
                  type={building.field.type === "date" ? "date" : "text"}
                  placeholder={
                    building.op === "is any of" ? "a, b, c" : "value"
                  }
                  value={building.value ?? ""}
                  onChange={(e) =>
                    setBuilding((b) => ({ ...b, value: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") {
                      setAddOpen(false);
                      setBuilding({});
                    }
                  }}
                />
              )
            ) : null}

            {building.field && building.op && building.value?.trim() ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={commit}
              >
                Add chip
              </button>
            ) : null}
          </div>
        ) : null}
      </span>
    </div>
  );
}
