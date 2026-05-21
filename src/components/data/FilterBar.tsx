import { Fragment, useEffect, useRef, useState } from "react";
import {
  IconFilter,
  IconX,
  IconPlus,
  IconChevronDown,
} from "@/components/icons/HQIcons";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

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

/**
 * Persisted sort state. Optional and orthogonal to chips: the DataTable
 * may own its own sort internally, but list pages that want sort to
 * round-trip through saved views (Phase 5.6.5 carry-forward starting
 * with Projects) read + write here and pass it through DataTable's
 * controlled props.
 */
export type FilterSort = { key: string; dir: "asc" | "desc" };

export type FilterState = {
  connector: "AND" | "OR";
  chips: FilterChip[];
  /** Optional. Pages that wire DataTable controlled-sort persist here. */
  sort?: FilterSort | null;
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
  type: "text" | "enum" | "user" | "date" | "lookup" | "presence";
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

export function emptyFilterState(): FilterState {
  return { connector: "AND", chips: [] };
}

export function FilterBar({
  state,
  onChange,
  fields,
  distinctValuesByField,
  allowIsNot = false,
}: {
  state: FilterState;
  onChange: (next: FilterState) => void;
  fields: FilterFieldDef[];
  /**
   * Phase 5.7.6: map of field key -> distinct values present in the
   * current page's row data. When provided for a text or enum field,
   * the value-step picker renders a cmdk searchable combobox listing
   * only those values + auto-commits the chip on select. Omit a key to
   * keep the field on its existing text input (text type) or full-enum
   * <select> (enum type) fallback.
   *
   * For "is any of" op the existing text input stays (cmdk single-pick
   * doesn't multi-select).
   */
  distinctValuesByField?: Record<string, string[]>;
  /**
   * Phase 5.7.8 followup: when true, the add-popover renders an
   * is / is not toggle between the field picker and the value step.
   * Default false (global single-op "is" lock); Tasks + Deliverables
   * opt in because exclusion-style filtering (e.g. "status is not
   * Done") is core to their default views.
   */
  allowIsNot?: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [building, setBuilding] = useState<{
    field?: FilterFieldDef;
    op?: string;
    value?: string;
  }>({});
  const popRef = useRef<HTMLDivElement>(null);
  const fieldSelectRef = useRef<HTMLSelectElement>(null);

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

  // Phase 5.7.6 follow-up: auto-open the native field <select> on add-
  // popover open so the user skips one click. Chromium 99+ / Firefox
  // 105+ expose HTMLSelectElement.showPicker(); on older browsers we
  // fall back to focus alone (the existing autoFocus prop covers it).
  useEffect(() => {
    if (!addOpen) return;
    const el = fieldSelectRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      try {
        (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
      } catch {
        // Some browsers throw if showPicker is called outside a user
        // gesture; click on the + Add filter chip IS a gesture so this
        // should usually succeed, but swallow defensively.
      }
    }, 0);
    return () => clearTimeout(t);
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

  /**
   * Phase 5.7.6: cmdk picks call this to skip the manual "Add chip"
   * click. Field + op are already locked in by the time the value step
   * renders; auto-commit on select is the canonical Notion / Linear
   * pattern for chip builders.
   */
  const commitWithValue = (rawValue: string) => {
    if (!building.field || !building.op) return;
    const v = rawValue.trim();
    if (!v) return;
    onChange({
      ...state,
      chips: [
        ...state.chips,
        { field: building.field.key, op: building.op, value: v },
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
            {chip.op !== "is" && chip.op !== "presence" ? (
              <span className="op">{chip.op}</span>
            ) : null}
            {chip.op !== "presence" ? (
              <span className="v">{chipDisplayValue(chip)}</span>
            ) : null}
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
              top: 0,
              left: "calc(100% + 6px)",
              zIndex: 30,
              padding: 10,
              display: "flex",
              flexDirection: "row",
              gap: 8,
              alignItems: "center",
              // Renders inline to the right of the + Add filter chip
              // rather than below it (5.7.6 round 2 follow-up). Each
              // step grows the popover further to the right; the
              // viewport-relative cap prevents overflow off-screen.
              maxWidth: "calc(100vw - 48px)",
            }}
          >
            <select
              ref={fieldSelectRef}
              className="input"
              style={{ height: 36, width: 180, flex: "0 0 auto" }}
              autoFocus
              value={building.field?.key ?? ""}
              onChange={(e) => {
                const f = fields.find((x) => x.key === e.target.value);
                // Presence fields are fixed-meaning: commit a single chip
                // immediately with no op / value step.
                if (f?.type === "presence") {
                  onChange({
                    ...state,
                    chips: [...state.chips, { field: f.key, op: "presence", value: "yes" }],
                  });
                  setAddOpen(false);
                  setBuilding({});
                  return;
                }
                setBuilding({ field: f, op: "is", value: "" });
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

            {allowIsNot && building.field ? (
              <select
                className="input"
                style={{ height: 36, width: 90, flex: "0 0 auto" }}
                value={building.op ?? "is"}
                onChange={(e) =>
                  setBuilding((b) => ({ ...b, op: e.target.value }))
                }
              >
                <option value="is">is</option>
                <option value="is not">is not</option>
              </select>
            ) : null}

            {(() => {
              if (!building.field || !building.op) return null;
              const fieldDef = building.field;
              const op = building.op;
              const distincts = distinctValuesByField?.[fieldDef.key];
              const hasDistinct =
                distincts !== undefined && distincts.length > 0;

              // Lookup type keeps its native select (id-based picker).
              if (fieldDef.type === "lookup" && fieldDef.lookupOptions) {
                return (
                  <select
                    className="input"
                    style={{ height: 36, width: 220, flex: "0 0 auto" }}
                    value={building.value ?? ""}
                    onChange={(e) =>
                      setBuilding((b) => ({ ...b, value: e.target.value }))
                    }
                  >
                    <option value="" disabled>
                      Value...
                    </option>
                    {fieldDef.lookupOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.sublabel ? `${o.name} (${o.sublabel})` : o.name}
                      </option>
                    ))}
                  </select>
                );
              }

              // Phase 5.7.6: searchable combobox for text + enum fields
              // when the parent provides distinct values from the current
              // rendered rows. "is any of" still falls through to the
              // text input (single-pick combobox can't multi-select).
              if (
                hasDistinct &&
                op !== "is any of" &&
                (fieldDef.type === "text" || fieldDef.type === "enum")
              ) {
                return (
                  <div
                    style={{
                      border: "1px solid hsl(var(--border-strong))",
                      borderRadius: "var(--radius)",
                      overflow: "hidden",
                      width: 240,
                      flex: "0 0 auto",
                    }}
                  >
                    <Command shouldFilter>
                      <CommandInput
                        placeholder="Search values..."
                        autoFocus
                      />
                      <CommandList style={{ maxHeight: 220 }}>
                        <CommandEmpty>No matches.</CommandEmpty>
                        <CommandGroup>
                          {distincts!.map((v) => (
                            <CommandItem
                              key={v}
                              value={v}
                              onSelect={() => commitWithValue(v)}
                              className="cursor-pointer"
                            >
                              {v}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </div>
                );
              }

              // Enum fallback (no distinct values provided): existing
              // native dropdown over the full enum options list.
              if (
                fieldDef.type === "enum" &&
                fieldDef.options &&
                op !== "is any of"
              ) {
                return (
                  <select
                    className="input"
                    style={{ height: 36, width: 200, flex: "0 0 auto" }}
                    value={building.value ?? ""}
                    onChange={(e) =>
                      setBuilding((b) => ({ ...b, value: e.target.value }))
                    }
                  >
                    <option value="" disabled>
                      Value...
                    </option>
                    {fieldDef.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                );
              }

              // Text / date / "is any of" / fallback: existing free-text
              // input (date type uses the native date picker via type).
              return (
                <input
                  className="input"
                  style={{ height: 36, width: 220, flex: "0 0 auto" }}
                  type={fieldDef.type === "date" ? "date" : "text"}
                  placeholder={op === "is any of" ? "a, b, c" : "value"}
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
              );
            })()}

            {building.field && building.op && building.value?.trim() ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ flex: "0 0 auto", alignSelf: "center" }}
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
