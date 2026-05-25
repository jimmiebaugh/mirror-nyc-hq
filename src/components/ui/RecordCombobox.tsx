import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Link2, X } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  MiniCreateModal,
  type MiniCreateField,
} from "@/components/ui/MiniCreateModal";
import {
  useCityAliases,
  useLookup,
  type CityAliasOption,
  type LookupTable,
} from "@/lib/hq/lookups";
import { supabase } from "@/integrations/supabase/client";

/**
 * Notion-style typeahead with inline-add (Phase 5.6.1 spec § 4.A).
 *
 * Replaces InlineAddSelect's native `<select>` with a Radix Popover +
 * cmdk `<Command>`. Two modes:
 *
 *   - `lookup`: backed by `useLookup` over one of the shared lookup
 *     tables. Value semantics are the option NAME (text), matching the
 *     pattern InlineAddSelect established (form columns are text, not
 *     FKs). Inline "+ Add" inserts a row through useLookup.addOption.
 *
 *   - `record`: backed by a parent-supplied async `loadOptions`. Value is
 *     the record id (FK). Inline "+ Add" opens MiniCreateModal with the
 *     fields the parent declared; the parent's `onMiniCreate` handler
 *     resolves to `{ id, label }` so the freshly-inserted record is
 *     immediately selected.
 *
 * Filtering: cmdk's default fuzzy scoring (prefix-match first, then
 * contains). The "+ Add" item always pins to the bottom via `forceMount`
 * so it survives the filter.
 *
 * Multi-select: pass `multi` + `multiValue` + `onMultiChange`. Selected
 * options render as removable chips above the typeahead input; selecting
 * toggles membership.
 */

export type Option = { id: string; label: string };

type LookupSource = {
  kind: "lookup";
  table: LookupTable;
  /**
   * Phase 5.6.2: scope option list to rows whose `parent_category_id`
   * matches. Only `vendor_subcategories` supports this today; the hook
   * passes it through to the SELECT filter and the INSERT payload.
   */
  parentScopeId?: string | null;
  /**
   * Optional human label for `parentScopeId`. When provided, mini-create
   * renders it as a read-only `<parentScopeLabelKey>: <parentScopeLabel>`
   * row so users see which record the new option will be nested under.
   */
  parentScopeLabel?: string | null;
  /** Field label for the parent scope row (e.g. "Category"). */
  parentScopeLabelKey?: string;
};
type RecordSource = {
  kind: "record";
  loadOptions: () => Promise<Option[]>;
};
/**
 * Phase 5.9.2: active Mirror staff keyed by email. Option `id` is the email
 * (not the user uuid) because consumers resolve people by email (the bulk
 * import RPC matches `users.email`). No inline-create path: staff are
 * pre-provisioned via /users only, so the "+ Add" affordance is suppressed.
 */
type UsersByEmailSource = {
  kind: "users-by-email";
};

type SingleProps = {
  multi?: false;
  value: string | null;
  onChange: (next: string | null) => void;
  multiValue?: never;
  onMultiChange?: never;
};

type MultiProps = {
  multi: true;
  multiValue: string[];
  onMultiChange: (next: string[]) => void;
  value?: never;
  onChange?: never;
};

type CommonProps = {
  source: LookupSource | RecordSource | UsersByEmailSource;
  placeholder?: string;
  entityLabel: string;
  disabled?: boolean;
  /** Required for `record` source mini-create. Omit for lookup (built-in). */
  miniCreateFields?: MiniCreateField[];
  /** Required for `record` source mini-create. Omit for lookup (built-in). */
  onMiniCreate?: (
    data: Record<string, string>,
  ) => Promise<Option | null>;
  /**
   * Phase 5.7.1: when true, "+ Add" inserts the row using the typed input as
   * the only field (key `name`) instead of opening MiniCreateModal. Use for
   * record-mode pickers whose insert helper only needs the name (Client,
   * Venue). Leave false for pickers that need more fields (Vendor → Category,
   * Person → email).
   */
  quickCreate?: boolean;
  /**
   * Phase 5.7.12 followup: when explicitly false, the "+ Add" affordance
   * is suppressed even on lookup-mode sources where insert is otherwise
   * always available. Use when the caller wants the picker to be choose-only
   * (e.g. self-service surfaces like /settings/profile, where only admins
   * should add departments via the Settings Lookup Lists card).
   */
  allowCreate?: boolean;
  /**
   * Phase 5.7.3 followup-5: when set, a populated value renders as a coral
   * hyperlink to the record's detail page. The chevron becomes a Link2 icon
   * and the icon button (not the label) is the picker trigger. Pass `null`
   * from the resolver to skip the link for a specific id.
   */
  getRecordHref?: (id: string) => string | null;
  /**
   * Phase 5.7.3 followup-5: multi-select display mode.
   *   - "chips" (default): selected options render as a chip row inside the
   *     picker trigger (existing behavior).
   *   - "stack": selected options render as a vertical stack of coral
   *     hyperlinks, one per row, with a single Link2 icon button at the
   *     end of the wrapper that opens the picker. Only meaningful with
   *     `getRecordHref` set; use for fields where the parent wants the
   *     selection to read as a navigable list rather than an inline chip
   *     row (e.g. ProjectDetail Venue).
   */
  displayAs?: "chips" | "stack";
  /**
   * Phase 5.7.14: when true, the in-trigger chip render for `multi` mode is
   * suppressed and the trigger shows the placeholder text instead. Use when
   * the consumer is rendering the selection somewhere else (e.g. a sibling
   * VenueTypePill row). Selection state, popover, and "+ Add" are unaffected.
   */
  hideMultiValueChips?: boolean;
};

export type RecordComboboxProps = CommonProps & (SingleProps | MultiProps);

export function RecordCombobox(props: RecordComboboxProps) {
  // Split into two child components so each can own its own hook setup
  // without conditionally calling useLookup.
  if (props.source.kind === "lookup") {
    return <LookupCombobox {...props} source={props.source} />;
  }
  if (props.source.kind === "users-by-email") {
    return <UsersByEmailCombobox {...props} source={props.source} />;
  }
  return <RecordSourceCombobox {...props} source={props.source} />;
}

async function loadActiveUsersByEmail(): Promise<Option[]> {
  const { data, error } = await supabase
    .from("users")
    .select("email, full_name")
    .eq("active", true)
    .order("full_name", { ascending: true });
  if (error || !data) return [];
  return data
    .filter((u) => u.email)
    .map((u) => ({
      id: u.email as string,
      label: u.full_name ? `${u.full_name} <${u.email}>` : (u.email as string),
    }));
}

function UsersByEmailCombobox(
  props: RecordComboboxProps & { source: UsersByEmailSource },
) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);

  // No inline-create for staff; warn + ignore if a caller wires one up.
  if (props.onMiniCreate) {
    console.warn(
      "RecordCombobox: onMiniCreate is ignored for the users-by-email source (staff are pre-provisioned via /users).",
    );
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadActiveUsersByEmail().then((opts) => {
      if (!active) return;
      setOptions(opts);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <ComboboxView
      {...props}
      allowCreate={false}
      options={options}
      loading={loading}
      insertOption={async () => null}
    />
  );
}

function LookupCombobox(
  props: RecordComboboxProps & { source: LookupSource },
) {
  const lookup = useLookup(props.source.table, {
    parentScopeId: props.source.parentScopeId ?? null,
  });
  // Phase 5.12.2: aliases load only when the source table is `cities`.
  // For every other lookup, aliasesEnabled is false and the hook short-
  // circuits to an empty list. Aliases render as a secondary, read-only
  // CommandGroup below the canonical options; selecting an alias picks
  // its canonical city. Inline-create is unaffected (aliases are not
  // creatable through the picker).
  const aliasesEnabled = props.source.table === "cities";
  const aliasesHook = useCityAliases();
  const aliasOptions: CityAliasOption[] = aliasesEnabled
    ? aliasesHook.options
    : [];

  const options: Option[] = useMemo(
    () => lookup.options.map((o) => ({ id: o.name, label: o.name })),
    [lookup.options],
  );

  const insert = async (data: Record<string, string>): Promise<Option | null> => {
    const name = data[Object.keys(data)[0] ?? ""] ?? "";
    const added = await lookup.addOption(name);
    if (!added) return null;
    return { id: added.name, label: added.name };
  };

  const miniCreateContext = useMemo(() => {
    const label = props.source.parentScopeLabel;
    const key = props.source.parentScopeLabelKey;
    if (!label || !key) return undefined;
    return [{ label: key, value: label }];
  }, [props.source.parentScopeLabel, props.source.parentScopeLabelKey]);

  return (
    <ComboboxView
      {...props}
      options={options}
      loading={lookup.loading}
      insertOption={insert}
      miniCreateContext={miniCreateContext}
      aliasOptions={aliasOptions}
    />
  );
}

function RecordSourceCombobox(
  props: RecordComboboxProps & { source: RecordSource },
) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);

  const { loadOptions } = props.source;

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadOptions().then((opts) => {
      if (!active) return;
      setOptions(opts);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadOptions]);

  const insert = async (data: Record<string, string>): Promise<Option | null> => {
    if (!props.onMiniCreate) return null;
    const created = await props.onMiniCreate(data);
    if (created) {
      setOptions((prev) =>
        [...prev, created].sort((a, b) => a.label.localeCompare(b.label)),
      );
    }
    return created;
  };

  return (
    <ComboboxView
      {...props}
      options={options}
      loading={loading}
      insertOption={insert}
    />
  );
}

type ViewProps = RecordComboboxProps & {
  options: Option[];
  loading: boolean;
  insertOption: (data: Record<string, string>) => Promise<Option | null>;
  miniCreateContext?: { label: string; value: string }[];
  /**
   * Phase 5.12.2: optional alias rows (cities only today). Render as a
   * read-only secondary group below the canonical options. Selecting an
   * alias row picks the canonical city via its `canonical` field.
   * Filtering uses the `alias` text as the cmdk value so typing
   * "Los Angeles" matches the alias whose canonical is "LA".
   */
  aliasOptions?: CityAliasOption[];
};

function ComboboxView(props: ViewProps) {
  const {
    options,
    loading,
    insertOption,
    placeholder,
    entityLabel,
    disabled,
    miniCreateFields,
    miniCreateContext,
    aliasOptions,
  } = props;

  const isMulti = props.multi === true;
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [miniOpen, setMiniOpen] = useState(false);

  const optionLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.id, o.label);
    return m;
  }, [options]);

  const selectedLabels: Option[] = useMemo(() => {
    if (!isMulti) return [];
    return (props.multiValue ?? []).map((id) => ({
      id,
      label: optionLabelById.get(id) ?? id,
    }));
  }, [isMulti, props.multiValue, optionLabelById]);

  const singleLabel =
    !isMulti && props.value
      ? (optionLabelById.get(props.value) ?? props.value)
      : null;

  const placeholderText = placeholder ?? `Select ${entityLabel}...`;

  const handlePick = (option: Option) => {
    if (isMulti) {
      const current = new Set(props.multiValue ?? []);
      if (current.has(option.id)) {
        current.delete(option.id);
      } else {
        current.add(option.id);
      }
      props.onMultiChange(Array.from(current));
      setInputValue("");
    } else {
      // Re-click on the currently selected option toggles it off (sets the
      // field to null). Phase 5.6.3: matches the multi-select behavior and
      // gives users a way to deselect without an explicit clear button.
      const next = props.value === option.id ? null : option.id;
      props.onChange(next);
      setInputValue("");
      setOpen(false);
    }
  };

  const removeChip = (id: string) => {
    if (!isMulti) return;
    props.onMultiChange((props.multiValue ?? []).filter((x) => x !== id));
  };

  const resolvedMiniFields: MiniCreateField[] = useMemo(() => {
    if (miniCreateFields && miniCreateFields.length > 0) return miniCreateFields;
    return [{ key: "name", label: "Name", required: true }];
  }, [miniCreateFields]);

  // "+ Add" is offered when there's a working insert path. Lookup sources
  // always have one (lookup.addOption). Record sources only have one when
  // the parent wired up `onMiniCreate` — without it, insertOption silently
  // returns null and MiniCreateModal shows a misleading "Create failed"
  // toast. Hide the affordance entirely in that case. Also hide when the
  // caller explicitly opts out via `allowCreate={false}` (choose-only mode).
  const canCreate =
    props.allowCreate !== false &&
    (props.source.kind === "lookup" || Boolean(props.onMiniCreate));

  const hideMultiValueChips = isMulti && props.hideMultiValueChips === true;
  const filled = isMulti
    ? selectedLabels.length > 0 && !hideMultiValueChips
    : Boolean(props.value);
  const getRecordHref = props.getRecordHref;
  const displayAs = props.displayAs ?? "chips";
  // Phase 5.7.3 followup-5: when getRecordHref is supplied AND a value is
  // selected, the label becomes a coral hyperlink and the chevron flips
  // to a Link2 icon button that owns the picker click. When empty (or
  // no resolver), keep the existing whole-trigger button.
  const linkMode = Boolean(getRecordHref) && filled;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        {linkMode ? (
          isMulti && displayAs === "stack" ? (
            // Per-row Link2 button opens the picker; clicking an already-
            // selected row in the picker deselects it (no per-row X needed).
            // PopoverAnchor wraps the stack so the picker positions next to
            // the list regardless of which row was clicked.
            <PopoverAnchor asChild>
              <div className="combo-stack">
                {selectedLabels.map((s) => {
                  const href = getRecordHref!(s.id);
                  return (
                    <div key={s.id} className="combo-stack-row">
                      {href ? (
                        <Link to={href} className="combo-link" title={s.label}>
                          {s.label}
                        </Link>
                      ) : (
                        <span className="combo-link" style={{ cursor: "default" }}>
                          {s.label}
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setOpen(true)}
                        className="combo-picker-btn"
                        aria-label={`Edit ${entityLabel}`}
                      >
                        <Link2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </PopoverAnchor>
          ) : (
            <div
              className="combobox-trigger"
              style={{ padding: 0, cursor: "default", gap: 4 }}
            >
              {isMulti ? (
                <span className="flex flex-1 flex-wrap items-center gap-1.5" style={{ minWidth: 0 }}>
                  {selectedLabels.map((s) => {
                    const href = getRecordHref!(s.id);
                    return (
                      <span
                        key={s.id}
                        className="pill pill-sm p-muted inline-flex items-center gap-1 text-[13px]"
                      >
                        {href ? (
                          <Link to={href} className="combo-link" style={{ fontWeight: 400 }}>
                            {s.label}
                          </Link>
                        ) : (
                          <span>{s.label}</span>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove ${s.label}`}
                          onClick={() => removeChip(s.id)}
                          className="opacity-70 hover:opacity-100"
                          style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", display: "inline-flex" }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                </span>
              ) : (
                (() => {
                  const id = props.value as string;
                  const href = getRecordHref!(id);
                  return href ? (
                    <Link
                      to={href}
                      className="combo-link"
                      style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={singleLabel ?? ""}
                    >
                      {singleLabel}
                    </Link>
                  ) : (
                    <span
                      className="combo-link"
                      style={{ cursor: "default", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {singleLabel}
                    </span>
                  );
                })()
              )}
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  className="combo-picker-btn"
                  aria-label={`Edit ${entityLabel}`}
                >
                  <Link2 className="h-4 w-4" />
                </button>
              </PopoverTrigger>
            </div>
          )
        ) : (
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="combobox-trigger selectish text-left"
              style={{
                minHeight: 40,
                height: "auto",
                padding: isMulti && filled ? "6px 10px" : undefined,
              }}
            >
              {isMulti ? (
                filled ? (
                  <span className="flex flex-1 flex-wrap items-center gap-1.5" style={{ minWidth: 0 }}>
                    {selectedLabels.map((s) => (
                      <span
                        key={s.id}
                        className="pill pill-sm p-muted inline-flex items-center gap-1 text-[13px]"
                      >
                        {s.label}
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label={`Remove ${s.label}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeChip(s.id);
                          }}
                          className="cursor-pointer opacity-70 hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </span>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="flex-1 text-[hsl(var(--subtle-foreground))]">
                    {placeholderText}
                  </span>
                )
              ) : singleLabel ? (
                <span className="flex-1 truncate">{singleLabel}</span>
              ) : (
                <span className="flex-1 truncate text-[hsl(var(--subtle-foreground))]">
                  {placeholderText}
                </span>
              )}
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-[hsl(var(--primary))]" />
            </button>
          </PopoverTrigger>
        )}
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command shouldFilter>
            <CommandInput
              value={inputValue}
              onValueChange={setInputValue}
              placeholder={`Search ${entityLabel}...`}
            />
            <CommandList>
              {loading ? (
                <div className="py-3 text-center text-xs text-muted-foreground">
                  Loading...
                </div>
              ) : (
                <CommandEmpty>No results.</CommandEmpty>
              )}
              {options.length > 0 ? (
                <CommandGroup>
                  {options.map((opt) => {
                    const isSelected = isMulti
                      ? (props.multiValue ?? []).includes(opt.id)
                      : props.value === opt.id;
                    return (
                      <CommandItem
                        key={opt.id}
                        value={opt.label}
                        onSelect={() => handlePick(opt)}
                        className="cursor-pointer text-[15px]"
                      >
                        <span className="flex-1 truncate">{opt.label}</span>
                        {isSelected ? (
                          <Check className="ml-2 h-4 w-4 text-primary" />
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
              {aliasOptions && aliasOptions.length > 0 ? (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Aliases">
                    {aliasOptions.map((a) => (
                      <CommandItem
                        key={`alias:${a.alias}`}
                        value={a.alias}
                        onSelect={() =>
                          handlePick({ id: a.canonical, label: a.canonical })
                        }
                        className="cursor-pointer text-[15px]"
                      >
                        <span className="flex-1 truncate text-muted-foreground">
                          {a.alias}
                        </span>
                        <span className="ml-2 font-mono text-xs uppercase text-primary">
                          {a.canonical}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              ) : null}
              {canCreate ? (
                <>
                  <CommandSeparator />
                  <CommandGroup forceMount>
                    <CommandItem
                      forceMount
                      // Cmdk filters on `value`; a literal sentinel keeps the
                      // Add item visible regardless of typed input.
                      value="__add_new__"
                      onSelect={async () => {
                        const typed = inputValue.trim();
                        if (props.quickCreate && typed) {
                          const created = await insertOption({ name: typed });
                          if (created) {
                            if (isMulti) {
                              const current = new Set(props.multiValue ?? []);
                              current.add(created.id);
                              props.onMultiChange(Array.from(current));
                            } else {
                              props.onChange(created.id);
                              setOpen(false);
                            }
                            setInputValue("");
                          }
                          return;
                        }
                        setMiniOpen(true);
                        setOpen(false);
                      }}
                      className="cursor-pointer text-primary font-mono text-xs uppercase"
                    >
                      {inputValue.trim()
                        ? `+ Add "${inputValue.trim()}"`
                        : "+ Add new..."}
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <MiniCreateModal
        open={miniOpen}
        onOpenChange={setMiniOpen}
        entityLabel={entityLabel}
        fields={resolvedMiniFields}
        initialName={inputValue.trim() || undefined}
        context={miniCreateContext}
        onSubmit={insertOption}
        onCreated={(created) => {
          if (isMulti) {
            const current = new Set(props.multiValue ?? []);
            current.add(created.id);
            props.onMultiChange(Array.from(current));
          } else {
            props.onChange(created.id);
          }
          setInputValue("");
        }}
      />
    </>
  );
}
