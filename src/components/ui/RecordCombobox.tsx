import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import {
  Popover,
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
import { useLookup, type LookupTable } from "@/lib/hq/lookups";

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
  source: LookupSource | RecordSource;
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
};

export type RecordComboboxProps = CommonProps & (SingleProps | MultiProps);

export function RecordCombobox(props: RecordComboboxProps) {
  // Split into two child components so each can own its own hook setup
  // without conditionally calling useLookup.
  if (props.source.kind === "lookup") {
    return <LookupCombobox {...props} source={props.source} />;
  }
  return <RecordSourceCombobox {...props} source={props.source} />;
}

function LookupCombobox(
  props: RecordComboboxProps & { source: LookupSource },
) {
  const lookup = useLookup(props.source.table, {
    parentScopeId: props.source.parentScopeId ?? null,
  });
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
  // toast. Hide the affordance entirely in that case.
  const canCreate =
    props.source.kind === "lookup" || Boolean(props.onMiniCreate);

  const filled = isMulti ? selectedLabels.length > 0 : Boolean(props.value);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={`input ${filled ? "input--filled" : ""} selectish text-left`}
            style={{
              minHeight: 44,
              height: "auto",
              padding: isMulti && filled ? "6px 10px" : undefined,
            }}
          >
            {isMulti ? (
              filled ? (
                <span className="flex flex-1 flex-wrap items-center gap-1.5">
                  {selectedLabels.map((s) => (
                    <span
                      key={s.id}
                      className="pill pill-sm p-muted inline-flex items-center gap-1"
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
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
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
                        className="cursor-pointer"
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
