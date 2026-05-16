import { useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { LookupOption } from "@/lib/hq/lookups";

/**
 * @deprecated Phase 5.6.1 — replaced by `RecordCombobox` (typeahead +
 * mini-create modal). All callsites migrated; this file is kept only so a
 * missed grep doesn't crash at runtime. Delete after a one-cycle soak.
 *
 * Original shape preserved verbatim below for the soak window.
 *
 * Wireframe-canonical inline-add select. Phase 5.2.2 spec § 6.C.
 *
 * Renders a `.input` select with the existing options + a final
 * "+ Add new..." sentinel; choosing the sentinel opens a small
 * AlertDialog with one input, calls `onAdd(name)` (the lookup helper's
 * `addOption`), and selects the freshly-inserted row on success.
 *
 * The value semantics: the form binds to the option's name (text), not the
 * id, because the consumers (organizations.city, projects.category,
 * organizations.capabilities array) are text columns rather than FKs. The
 * lookup table only seeds the option list.
 */

export function InlineAddSelect({
  options,
  value,
  onSelect,
  onAdd,
  filled,
  placeholder,
  entityLabel,
  exampleName,
}: {
  options: LookupOption[];
  value: string | null;
  onSelect: (next: string) => void;
  onAdd: (name: string) => Promise<LookupOption | null>;
  filled?: boolean;
  placeholder?: string;
  entityLabel: string;
  exampleName?: string;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <select
        className={`input ${filled ?? Boolean(value) ? "input--filled" : ""}`}
        value={value ?? ""}
        onChange={async (e) => {
          if (e.target.value === "__add_new__") {
            setOpen(true);
          } else {
            onSelect(e.target.value);
          }
        }}
      >
        <option value="">{placeholder ?? `Select ${entityLabel}...`}</option>
        {options.map((o) => (
          <option key={o.id} value={o.name}>
            {o.name}
          </option>
        ))}
        <option value="__add_new__">+ Add new...</option>
      </select>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a new {entityLabel}</AlertDialogTitle>
          </AlertDialogHeader>
          <input
            ref={inputRef}
            className="input"
            autoFocus
            placeholder={exampleName ? `e.g. ${exampleName}` : ""}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const name = inputRef.current?.value.trim() ?? "";
                if (!name) return;
                const added = await onAdd(name);
                if (added) {
                  onSelect(added.name);
                  setOpen(false);
                }
              }}
            >
              Add
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
